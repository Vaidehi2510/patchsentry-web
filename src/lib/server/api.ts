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
  testing_profile?: TestingProfile;
  runner?: Runner | null;
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
    name: row.name,
    repository: row.repository,
    createdAt: iso(row.created_at),
    settings: row.settings,
    agentLastSeen: row.agent_last_seen ? iso(row.agent_last_seen) : null,
    localModels: row.local_models,
    tokenConfigured: Boolean(row.agent_token_hash),
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
  const session = await runtime.auth.api.getSession({
    headers: request.headers,
  });
  if (!session?.user) throw new ApiError(401, "Sign in to continue.");
  return session.user;
}
async function ownedProject(
  runtime: Runtime,
  id: string,
  ownerId: string,
): Promise<ProjectRow> {
  const result = await runtime.database.query<ProjectRow>(
    "SELECT * FROM projects WHERE id = $1 AND owner_id = $2",
    [id, ownerId],
  );
  if (!result.rows[0]) throw new ApiError(404, "Project not found.");
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
    "SELECT * FROM projects WHERE agent_token_hash = $1",
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
    if (!runtime) return json({ user: null, configured: false });
    const session = await runtime.auth.api.getSession({
      headers: request.headers,
    });
    return json({
      user: session?.user
        ? {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          }
        : null,
      configured: true,
    });
  }
  if (!runtime)
    throw new ApiError(
      503,
      "Account storage is not configured. Set the database and authentication environment variables.",
    );
  if (path.startsWith("/api/auth/")) {
    if (!["GET", "POST"].includes(request.method))
      throw new ApiError(405, "Method not allowed.");
    if (request.method === "POST") {
      requireOrigin(request, runtime.config.origin);
      const body = await readBody(request);
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      return runtime.auth.handler(
        new Request(request.url, {
          method: request.method,
          headers,
          body: JSON.stringify(body),
        }),
      );
    }
    return runtime.auth.handler(request);
  }
  if (path.startsWith("/api/agent/")) {
    const project = await agentProject(request, runtime);
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
      await runtime.database.query(
        "UPDATE projects SET local_models = $1::jsonb, agent_last_seen = now(), runner = $3::jsonb WHERE id = $2",
        [JSON.stringify(input.models), project.id, input.runner ? JSON.stringify(input.runner) : null],
      );
      return json({ ok: true });
    }
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
          AND qa_runs.payload->'pr'->>'number' = EXCLUDED.payload->'pr'->>'number'
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
  if (path === "/api/projects") {
    if (request.method === "GET") {
      const result = await runtime.database.query<ProjectRow>(
        "SELECT * FROM projects WHERE owner_id = $1 ORDER BY created_at DESC",
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
    const project = await ownedProject(runtime, jobMatch[1], user.id);
    if (!jobMatch[2] && request.method === "GET") return json({ jobs: await listJobs(runtime.database, project.id) });
    if (!jobMatch[2] && request.method === "POST") return json(await createJob(runtime.database, project, await readBody(request)), 201);
    if (jobMatch[2] && request.method === "POST") return json({ job: await changeJob(runtime.database, project, jobMatch[2], jobMatch[3] as "retry" | "cancel") });
    throw new ApiError(405, "Method not allowed.");
  }
  const projectMatch = /^\/api\/projects\/([a-f0-9-]{36})(?:\/(token|runs))?$/.exec(path);
  if (projectMatch) {
    const project = await ownedProject(runtime, projectMatch[1], user.id);
    if (projectMatch[2] === "token" && request.method === "POST") {
      const token = "pst_" + randomBytes(32).toString("base64url");
      await runtime.database.query(
        "UPDATE projects SET agent_token_hash = $1, runner=NULL, agent_last_seen=NULL, updated_at = now() WHERE id = $2 AND owner_id = $3",
        [hashToken(token), project.id, user.id],
      );
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
        "UPDATE projects SET settings = $1::jsonb, testing_profile=$4::jsonb, updated_at = now() WHERE id = $2 AND owner_id = $3 RETURNING *",
        [JSON.stringify(input.settings || project.settings), project.id, user.id, JSON.stringify(input.testingProfile || project.testing_profile || testingDefaults)],
      );
      return json({ project: projectView(result.rows[0]) });
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
    if (error instanceof ApiError || error instanceof JobError)
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
