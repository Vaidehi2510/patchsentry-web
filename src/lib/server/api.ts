import {securityState, securityEndpoint, credentialExists, passwordSignIn, authCall, securitySignOut, resetWithMfa, setupRequestLimit, SecurityError} from './session-security';
import { roleRank, SlackSettingsSchema, slackDefaults, type AccessRole } from '../team';
import { audit, members, invite, acceptInvite, removeMember, queueNotification, claimNotification, finishNotification } from './team';
import { releaseGate } from "../release-gate";
import { AssessmentTargetSchema } from "../targets";
import { listTestCases, saveTestCase, deleteTestCase } from "./test-cases";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  LocalModelSchema,
  RunInputSchema,
  SettingsSchema,
  computeScore,
  settingsDefaults,
  type Project,
  type LocalModel,
  type Settings,
  type Run,
} from "../contracts";
import { getRuntime, type Runtime } from "./runtime";
import { getCatalog } from "./catalog";
import { RunnerSchema, TestingProfileSchema, testingDefaults, type Runner, type TestingProfile } from "../jobs";
import { JobError, createJob, listJobs, changeJob, claimJob, updateLease } from "./jobs";

const BODY_LIMIT = 256 * 1024;
const CreateProject = z
  .object({
    name: z.string().trim().min(1).max(80),
    repository: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
      .max(201),
  })
  .strict();
const ChangeProject = z.object({ settings: SettingsSchema.optional(), testingProfile: TestingProfileSchema.optional() }).strict().refine(v => v.settings || v.testingProfile);
const Heartbeat = z
  .object({
    models: z
      .array(LocalModelSchema)
      .max(100)
      .refine(
        (models) => new Set(models.map((m) => m.id)).size === models.length,
        "Duplicate models",
      ),
    runner: RunnerSchema.optional(),
  })
  .strict();
type ProjectRow = {
  id: string;
  owner_id: string;
  name: string;
  repository: string;
  created_at: Date | string;
  settings: Settings;
  agent_last_seen: Date | string | null;
  local_models: LocalModel[];
  agent_token_hash: string | null;
  agent_email_verified: boolean;
  testing_profile?: TestingProfile;
  runner?: Runner | null;
  access_role?: AccessRole;
  slack_settings?: unknown;
  max_parallel?: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function iso(value: Date | string) {
  return new Date(value).toISOString();
}
function projectView(row: ProjectRow): Project {
  return {
    id: row.id,
    accessRole: row.access_role || "owner",
    maxParallel: row.max_parallel || 1,
    name: row.name,
    repository: row.repository,
    createdAt: iso(row.created_at),
    settings: row.settings,
    agentLastSeen: row.agent_last_seen ? iso(row.agent_last_seen) : null,
    localModels: row.local_models,
    tokenConfigured: Boolean(row.agent_token_hash && row.agent_email_verified),
    testingProfile: row.testing_profile || testingDefaults,
    runner: row.runner || null,
  };
}
export function requireOrigin(request: Request, origin: string) {
  if (
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(
      403,
      "This action requires a request from this website.",
    );
}
export async function readBody(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  )
    throw new ApiError(415, "Send application/json.");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT))
    throw new ApiError(413, "Request body is too large.");
  if (!request.body) throw new ApiError(400, "A JSON body is required.");
  const reader = request.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > BODY_LIMIT) {
        await reader.cancel();
        throw new ApiError(413, "Request body is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "The body must contain valid JSON.");
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(
      400,
      "Invalid request fields. Check the submitted configuration or report.",
    );
  return parsed.data;
}
function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(
      /\b(?:pst_|sk-or-v1-|sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g,
      "[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{16,}/gi, "Bearer [REDACTED]")
    .replace(
      /((?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
      "$1[REDACTED]",
    );
}
function sanitize<T>(value: T): T {
  if (typeof value === "string") return cleanText(value) as T;
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitize(item)]),
    ) as T;
  return value;
}
async function userFor(request: Request, runtime: Runtime) {
  const state=await securityState(request,runtime);
  if(state.step!=='complete'||!state.session)throw new ApiError(401,'Complete password sign-in and two-step verification to continue.');
  return state.session.user;
}
async function accessibleProject(
  runtime: Runtime,
  id: string,
  ownerId: string,
  minimum: AccessRole = "viewer",
): Promise<ProjectRow> {
  const result = await runtime.database.query<ProjectRow>(
    `SELECT p.*,CASE WHEN p.owner_id=$2 THEN 'owner' ELSE m.role END AS access_role FROM projects p LEFT JOIN qa_members m ON m.project_id=p.id AND m.user_id=$2 WHERE p.id=$1 AND (p.owner_id=$2 OR m.user_id IS NOT NULL)`,
    [id, ownerId],
  );
  if (!result.rows[0]) throw new ApiError(404, "Project not found.");
  if (roleRank[result.rows[0].access_role || "owner"] < roleRank[minimum]) throw new ApiError(403, "Your project role does not allow this action.");
  return result.rows[0];
}
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
async function agentProject(
  request: Request,
  runtime: Runtime,
): Promise<ProjectRow> {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer pst_[A-Za-z0-9_-]{43}$/.test(authorization))
    throw new ApiError(401, "A valid project agent token is required.");
  const result = await runtime.database.query<ProjectRow>(
    'SELECT projects.* FROM projects JOIN "user" owner ON owner.id=projects.owner_id WHERE projects.agent_token_hash = $1 AND projects.agent_email_verified = true AND owner."emailVerified" = true',
    [hashToken(authorization.slice(7))],
  );
  if (!result.rows[0])
    throw new ApiError(401, "A valid project agent token is required.");
  return result.rows[0];
}
async function validateSettings(
  settings: Settings,
  project: ProjectRow,
  runtime: Runtime,
) {
  let catalog: Awaited<ReturnType<typeof getCatalog>> | undefined;
  for (const role of settings.roles) {
    const modelId = settings.roleModels[role] || settings.model;
    if (!modelId) continue; // Empty selection explicitly leaves the agent unconfigured.
    if (settings.backend === "local") {
      const model = project.local_models.find((item) => item.id === modelId);
      if (!model)
        throw new ApiError(
          400,
          "Select a local model reported by the connected agent.",
        );
      if (!model.tools)
        throw new ApiError(400, "QA models must support tool calling.");
      if (model.contextLength <= 3000)
        throw new ApiError(
          400,
          "QA models require a context window larger than 3000 tokens.",
        );
      if (settings.allowImages && role === "ui-ux" && !model.vision)
        throw new ApiError(400, "Screenshot review requires a vision model.");
    } else if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(
        modelId,
      ) ||
      ["openrouter/auto", "openrouter/free"].includes(modelId)
    ) {
      throw new ApiError(
        400,
        "Select a specific OpenRouter model from the catalog.",
      );
    } else {
      if (!catalog) {
        try {
          catalog = await (runtime.catalog ?? getCatalog)();
        } catch {
          throw new ApiError(
            503,
            "The OpenRouter model catalog is unavailable. Retry before saving model selection.",
          );
        }
      }
      const model = catalog.models.find((item) => item.id === modelId);
      if (!model)
        throw new ApiError(
          400,
          "Select a model available in the current OpenRouter catalog.",
        );
      if (!model.tools || model.contextLength <= 3000)
        throw new ApiError(
          400,
          "QA models require tool calling and a context window larger than 3000 tokens.",
        );
      if (settings.allowImages && role === "ui-ux" && !model.vision)
        throw new ApiError(400, "Screenshot review requires a vision model.");
    }
  }
}

async function dispatch(
  request: Request,
  runtime: Runtime | null,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  if (path === "/api/session" && request.method === "GET") {
    if (!runtime) return json({ user: null, configured: false, emailSignInReady: false });
    const state=await securityState(request,runtime);
    return json({user:state.step==='complete'&&state.session ? {id:state.session.user.id,name:state.session.user.name,email:state.session.user.email}:null,configured:true,emailSignInReady:Boolean(runtime.config.sendSignInLink),next:state.step==='complete'?'/app':state.step==='login'?'/login':'/auth/setup'});
  }
  if (!runtime)
    throw new ApiError(
      503,
      "Account storage is not configured. Set the database and authentication environment variables.",
    );
  if(path.startsWith('/api/security/')){if(request.method!=='GET')requireOrigin(request,runtime.config.origin);return securityEndpoint(request,runtime,request.method==='POST'?await readBody(request):undefined);}
  if (path.startsWith("/api/auth/")) {
    const allowed=new Set(['POST /api/auth/sign-in/magic-link','GET /api/auth/magic-link/verify','POST /api/auth/sign-out','POST /api/auth/sign-in/email','POST /api/auth/request-password-reset','POST /api/auth/reset-password']);
    if(!allowed.has(`${request.method} ${path}`) && !(request.method==='GET' && /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]+$/.test(path)))throw new ApiError(404,'Use the password and two-step verification flow.');
    if(request.method==='GET')return runtime.auth.handler(request);
    requireOrigin(request,runtime.config.origin);const raw=await readBody(request);
    if(path==='/api/auth/sign-in/email')return passwordSignIn(request,runtime,raw);
    if(path==='/api/auth/sign-in/magic-link'){
      const input=parse(z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),name:z.string().trim().min(1).max(100).optional()}).strict(),raw);
      await setupRequestLimit(request,runtime);
      // Setup links cannot replace password + 2FA for an enrolled account.
      const prior=(await runtime.database.query<{id:string;emailVerified:boolean}>('SELECT id,"emailVerified" FROM "user" WHERE lower(email)=$1',[input.email])).rows[0];
      if(prior?.emailVerified && await credentialExists(runtime,prior.id))return json({status:true});
      if(!runtime.config.sendSignInLink)throw new ApiError(503,'Email verification delivery is unavailable.');
      return authCall(request,runtime,'/sign-in/magic-link',{...input,name:input.name || input.email.split('@')[0].slice(0,100),callbackURL:'/auth/setup',newUserCallbackURL:'/auth/setup',errorCallbackURL:'/login'});
    }
    if(path==='/api/auth/request-password-reset'){const input=parse(z.object({email:z.email().max(254)}).strict(),raw);return authCall(request,runtime,'/request-password-reset',{...input,redirectTo:'/reset-password'});}
    if(path==='/api/auth/reset-password'){const input=parse(z.object({token:z.string().min(1).max(300),newPassword:z.string().min(12).max(128)}).strict(),raw);return resetWithMfa(request,runtime,input);}
    return securitySignOut(request,runtime);
  }
  if (path.startsWith("/api/agent/")) {
    const project = await agentProject(request, runtime);
    if (path === "/api/agent/release-gate" && request.method === "GET") {
      const recordId = url.searchParams.get("recordId") || "";
      const revision = url.searchParams.get("revision") || "";
      if (!/^[a-f0-9]{64}$/.test(recordId) || !/^[a-f0-9]{40}$/.test(revision)) throw new ApiError(400, "Provide the report ID and exact source revision.");
      const target = parse(AssessmentTargetSchema, { kind: url.searchParams.get("kind"), name: url.searchParams.get("name"), platform: url.searchParams.get("platform"), artifactSha256: url.searchParams.get("artifactSha256") });
      const result = await runtime.database.query<{ payload: Run }>("SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2", [project.id, recordId]);
      if (!result.rows[0]) throw new ApiError(404, "Release report not found for this project.");
      return json({ recordId, ...releaseGate(result.rows[0].payload, { revision, target }) });
    }
    if (path === "/api/agent/config" && request.method === "GET")
      return json({
        schemaVersion: 1,
        projectId: project.id,
        repository: project.repository,
        settings: project.settings,
        testingProfile: project.testing_profile || testingDefaults,
      });
    if (path === "/api/agent/heartbeat" && request.method === "POST") {
      const input = parse(
        Heartbeat,
        sanitize(parse(Heartbeat, await readBody(request))),
      );
      const c=await runtime.database.connect();
      try { await c.query('BEGIN'); await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project.id]);
        if(input.runner){
          await c.query("DELETE FROM qa_runners WHERE project_id=$1 AND last_seen<now()-interval '1 day' AND NOT EXISTS (SELECT 1 FROM qa_jobs j WHERE j.project_id=qa_runners.project_id AND j.runner_id=qa_runners.id AND j.status='running')",[project.id]);
          const n=await c.query<{n:string}>('SELECT count(*) AS n FROM qa_runners WHERE project_id=$1',[project.id]);
          const prior=await c.query('SELECT id FROM qa_runners WHERE project_id=$1 AND id=$2',[project.id,input.runner.id]);
          if(Number(n.rows[0].n)>=50 && !prior.rows.length)throw new ApiError(409,'A project supports up to 50 registered runners.');
          await c.query('INSERT INTO qa_runners (project_id,id,payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (project_id,id) DO UPDATE SET payload=EXCLUDED.payload,last_seen=now()',[project.id,input.runner.id,JSON.stringify(input.runner)]);
        }
        await c.query('UPDATE projects SET local_models=$1::jsonb,agent_last_seen=now(),runner=$3::jsonb WHERE id=$2',[JSON.stringify(input.models),project.id,input.runner?JSON.stringify(input.runner):null]);await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
      return json({ ok: true });
    }
    if(path==='/api/agent/notifications/claim' && request.method==='POST') return json(await claimNotification(runtime.database,project.id,await readBody(request)));
    const notifyMatch=/^\/api\/agent\/notifications\/([a-f0-9-]{36})\/complete$/.exec(path);
    if(notifyMatch && request.method==='POST')return json(await finishNotification(runtime.database,project.id,notifyMatch[1],await readBody(request)));
    if (path === "/api/agent/jobs/claim" && request.method === "POST") return json(await claimJob(runtime.database, project, await readBody(request)));
    const leaseMatch = /^\/api\/agent\/jobs\/([a-f0-9-]{36})\/(lease|complete)$/.exec(path);
    if (leaseMatch && request.method === "POST") return json(await updateLease(runtime.database, project.id, leaseMatch[1], sanitize(await readBody(request)), leaseMatch[2] === "complete"));
    const runMatch = /^\/api\/agent\/runs\/([a-f0-9]{64})$/.exec(path);
    if (runMatch && request.method === "PUT") {
      const input = parse(RunInputSchema, await readBody(request));
      if (
        input.recordId !== runMatch[1] ||
        input.repository.toLowerCase() !== project.repository
      )
        throw new ApiError(403, "Report identity does not match this project.");
      // Redaction can change IDs or empty required strings. Revalidate before
      // computing a denominator or persisting a malformed report.
      const cleaned = parse(
        RunInputSchema,
        sanitize({
          ...input,
          repository: project.repository,
          revision: input.revision.toLowerCase(),
        }),
      );
      const run: Run = {
        ...cleaned,
        score: computeScore(cleaned),
        receivedAt: new Date().toISOString(),
      };
      const result = await runtime.database.query(
        `INSERT INTO qa_runs (project_id, record_id, payload) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (project_id, record_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
        WHERE qa_runs.payload->>'revision' = EXCLUDED.payload->>'revision'
          AND (qa_runs.payload->'pr'->>'number') IS NOT DISTINCT FROM (EXCLUDED.payload->'pr'->>'number')
          AND (qa_runs.payload->'target') IS NOT DISTINCT FROM (EXCLUDED.payload->'target')
        RETURNING record_id`,
        [project.id, input.recordId, JSON.stringify(run)],
      );
      if (!result.rows.length)
        throw new ApiError(
          409,
          "A report record cannot change its PR or revision identity.",
        );
      await runtime.database.query(
        "UPDATE projects SET agent_last_seen = now() WHERE id = $1",
        [project.id],
      );
      return json({ run });
    }
    throw new ApiError(404, "Endpoint not found.");
  }
  if (request.method !== "GET") requireOrigin(request, runtime.config.origin);
  const user = await userFor(request, runtime);
  if (path === "/api/invitations/accept" && request.method === "POST") return json(await acceptInvite(runtime.database,user,await readBody(request)));
  const teamMatch = /^\/api\/projects\/([a-f0-9-]{36})\/(team|activity|fleet|slack)(?:\/([A-Za-z0-9_-]{1,100}))?$/.exec(path);
  if (teamMatch) {
    const area=teamMatch[2], action=teamMatch[3];
    const project=await accessibleProject(runtime,teamMatch[1],user.id,request.method==='GET' ? 'viewer' : 'admin');
    const role=project.access_role || 'owner';
    if(area==='team' && request.method==='GET') return json({members:await members(runtime.database,project.id),role,pending:(await runtime.database.query("SELECT 'invite-'||token_hash AS id,email,role,expires_at FROM qa_invites WHERE project_id=$1 AND expires_at>now() ORDER BY email",[project.id])).rows});
    if(area==='team' && !action && request.method==='POST') return json(await invite(runtime.database,project.id,user.name,role,await readBody(request)),201);
    if(area==='team' && action && request.method==='DELETE') {
      if(action.startsWith('invite-')){const r=await runtime.database.query("DELETE FROM qa_invites WHERE project_id=$1 AND token_hash=$2 AND ($3=true OR role<>'admin') RETURNING email",[project.id,action.slice(7),role==='owner']);if(!r.rows.length)throw new ApiError(404,'Invitation unavailable or only the owner can revoke an admin invitation.');await audit(runtime.database.query.bind(runtime.database),project.id,user.name,'member.invitation_revoked',String(r.rows[0].email));return json({revoked:true});}
      return json(await removeMember(runtime.database,project.id,user.name,role,action));
    }
    if(area==='activity' && request.method==='GET') return json({activity:(await runtime.database.query('SELECT actor,action,detail,created_at FROM qa_activity WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[project.id])).rows});
    if(area==='fleet' && request.method==='GET') return json({maxParallel:project.max_parallel || 1,runners:(await runtime.database.query('SELECT id,payload,last_seen,(SELECT count(*) FROM qa_jobs j WHERE j.project_id=r.project_id AND j.runner_id=r.id AND j.status=\'running\') AS active FROM qa_runners r WHERE project_id=$1 ORDER BY last_seen DESC',[project.id])).rows});
    if(area==='fleet' && request.method==='PATCH') {const input=parse(z.object({maxParallel:z.number().int().min(1).max(8)}).strict(),await readBody(request));await runtime.database.query('UPDATE projects SET max_parallel=$2 WHERE id=$1',[project.id,input.maxParallel]);await audit(runtime.database.query.bind(runtime.database),project.id,user.name,'fleet.capacity',String(input.maxParallel));return json(input);}
    if(area==='slack' && request.method==='GET') return json({settings:project.slack_settings || slackDefaults,deliveries:(await runtime.database.query('SELECT id,event_key,status,created_at,slack_ts FROM qa_notifications WHERE project_id=$1 ORDER BY created_at DESC LIMIT 30',[project.id])).rows});
    if(area==='slack' && request.method==='PATCH') {const input=parse(SlackSettingsSchema,await readBody(request));await runtime.database.query('UPDATE projects SET slack_settings=$2::jsonb WHERE id=$1',[project.id,JSON.stringify(input)]);await audit(runtime.database.query.bind(runtime.database),project.id,user.name,'slack.settings',input.enabled ? input.channelId : 'Disabled');return json({settings:input});}
    throw new ApiError(405,'Method not allowed.');
  }
  if (path === "/api/projects") {
    if (request.method === "GET") {
      const result = await runtime.database.query<ProjectRow>(
        `SELECT p.*,CASE WHEN p.owner_id=$1 THEN 'owner' ELSE m.role END AS access_role FROM projects p LEFT JOIN qa_members m ON m.project_id=p.id AND m.user_id=$1 WHERE p.owner_id=$1 OR m.user_id IS NOT NULL ORDER BY p.created_at DESC`,
        [user.id],
      );
      return json({ projects: result.rows.map(projectView) });
    }
    if (request.method === "POST") {
      const input = parse(CreateProject, await readBody(request));
      const count = await runtime.database.query<{ count: string }>(
        "SELECT count(*) AS count FROM projects WHERE owner_id = $1",
        [user.id],
      );
      if (Number(count.rows[0].count) >= 100)
        throw new ApiError(409, "This account has reached its project limit.");
      try {
        const result = await runtime.database.query<ProjectRow>(
          "INSERT INTO projects (id, owner_id, name, repository, settings) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *",
          [
            randomUUID(),
            user.id,
            cleanText(input.name),
            input.repository.toLowerCase(),
            JSON.stringify(settingsDefaults),
          ],
        );
        return json({ project: projectView(result.rows[0]) }, 201);
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          throw new ApiError(
            409,
            "This repository is already connected to your account.",
          );
        throw error;
      }
    }
    throw new ApiError(405, "Method not allowed.");
  }
  const jobMatch = /^\/api\/projects\/([a-f0-9-]{36})\/jobs(?:\/([a-f0-9-]{36})\/(retry|cancel))?$/.exec(path);
  if (jobMatch) {
    const project = await accessibleProject(runtime, jobMatch[1], user.id, request.method === "GET" ? "viewer" : "qa");
    if (!jobMatch[2] && request.method === "GET") return json({ jobs: await listJobs(runtime.database, project.id) });
    if (!jobMatch[2] && request.method === "POST") return json(await createJob(runtime.database, project, await readBody(request), user.name), 201);
    if (jobMatch[2] && request.method === "POST") return json({ job: await changeJob(runtime.database, project, jobMatch[2], jobMatch[3] as "retry" | "cancel", user.name) });
    throw new ApiError(405, "Method not allowed.");
  }
  const testsMatch = /^\/api\/projects\/([a-f0-9-]{36})\/tests(?:\/([a-f0-9-]{36}))?$/.exec(path);
  if (testsMatch) {
    const project = await accessibleProject(runtime, testsMatch[1], user.id, request.method === "GET" ? "viewer" : "qa");
    if (!testsMatch[2] && request.method === "GET") return json({ tests: await listTestCases(runtime.database, project.id) });
    if (!testsMatch[2] && request.method === "POST") { const test=await saveTestCase(runtime.database, project.id, await readBody(request)); await audit(runtime.database.query.bind(runtime.database),project.id,user.name,"test.created",test.name); return json({test},201); }
    if (testsMatch[2] && request.method === "PATCH") { const test=await saveTestCase(runtime.database, project.id, await readBody(request), testsMatch[2]); await audit(runtime.database.query.bind(runtime.database),project.id,user.name,"test.updated",`${test.name} · v${test.version}`); return json({test}); }
    if (testsMatch[2] && request.method === "DELETE") { const result=await deleteTestCase(runtime.database,project.id,testsMatch[2]);await audit(runtime.database.query.bind(runtime.database),project.id,user.name,"test.deleted",testsMatch[2]);return json(result); }
    throw new ApiError(405, "Method not allowed.");
  }
  const projectMatch = /^\/api\/projects\/([a-f0-9-]{36})(?:\/(token|runs))?$/.exec(path);
  if (projectMatch) {
    const project = await accessibleProject(runtime, projectMatch[1], user.id, request.method === "GET" ? "viewer" : projectMatch[2] === "token" || request.method === "DELETE" ? "owner" : "admin");
    if (projectMatch[2] === "token" && request.method === "POST") {
      const token = "pst_" + randomBytes(32).toString("base64url");
      await runtime.database.query(
        "UPDATE projects SET agent_token_hash = $1, agent_email_verified=true, runner=NULL, agent_last_seen=NULL, updated_at = now() WHERE id = $2 AND owner_id = $3",
        [hashToken(token), project.id, user.id],
      );
      await runtime.database.query("DELETE FROM qa_runners WHERE project_id=$1", [project.id]);
      await runtime.database.query("UPDATE qa_jobs SET status='blocked', lease_hash=NULL, lease_expires_at=NULL, message='Runner token rotated. Enroll the replacement token before retrying.', updated_at=now() WHERE project_id=$1 AND status='running'", [project.id]);
      return json({ token });
    }
    if (projectMatch[2] === "runs" && request.method === "GET") {
      const result = await runtime.database.query<{ payload: Run }>(
        "SELECT payload FROM qa_runs WHERE project_id = $1 ORDER BY updated_at DESC LIMIT 200",
        [project.id],
      );
      return json({
        runs: result.rows.map((row) => ({
          ...row.payload,
          score: computeScore(row.payload),
        })),
      });
    }
    if (!projectMatch[2] && request.method === "GET")
      return json({ project: projectView(project) });
    if (!projectMatch[2] && request.method === "PATCH") {
      const input = parse(ChangeProject, await readBody(request));
      if (input.settings) await validateSettings(input.settings, project, runtime);
      const result = await runtime.database.query<ProjectRow>(
        "UPDATE projects SET settings = $1::jsonb, testing_profile=$3::jsonb, updated_at = now() WHERE id = $2 RETURNING *",
        [JSON.stringify(input.settings || project.settings), project.id, JSON.stringify(input.testingProfile || project.testing_profile || testingDefaults)],
      );
      await audit(runtime.database.query.bind(runtime.database),project.id,user.name,'project.settings','Models or trusted testing profile updated');
      return json({ project: projectView({...result.rows[0],access_role:project.access_role}) });
    }
    if (!projectMatch[2] && request.method === "DELETE") {
      await runtime.database.query(
        "DELETE FROM projects WHERE id = $1 AND owner_id = $2",
        [project.id, user.id],
      );
      return json({ deleted: true });
    }
    throw new ApiError(405, "Method not allowed.");
  }
  throw new ApiError(404, "Endpoint not found.");
}

export async function handleRequest(
  request: Request,
  injected?: Runtime | null,
): Promise<Response> {
  try {
    return await dispatch(
      request,
      injected === undefined ? await getRuntime() : injected,
    );
  } catch (error) {
    if (error instanceof ApiError || error instanceof JobError || error instanceof SecurityError)
      return json({ error: error.message }, error.status);
    // Database credentials, session data and provider payloads must not reach responses.
    return json(
      {
        error:
          "The service could not complete this request. Check server configuration and database availability.",
      },
      503,
    );
  }
}
