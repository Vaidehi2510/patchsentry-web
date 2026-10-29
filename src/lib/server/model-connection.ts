import {
  createHash,
  createPublicKey,
  publicEncrypt,
  constants,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import {
  SetupRequest,
  RunnerId,
  type ConnectionView,
} from "../model-connection";
import { runnerOnline } from "../jobs";
import type { Runtime } from "./runtime";
import { JobError } from "./jobs";
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const label = (project: string, runner: string, id: string, backend: string) =>
  Buffer.from(`patchsentry:${project}:${runner}:${id}:${backend}`);
export function publicKey(value: string) {
  try {
    const key = createPublicKey(value);
    if (
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength || 0) < 3072
    )
      throw new Error();
    return key;
  } catch {
    throw new JobError(409, "Update the runner’s model-setup encryption key.");
  }
}
export async function verifyOpenRouter(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
) {
  try {
    const r = await fetchImpl("https://openrouter.ai/api/v1/key", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error();
    const reader = r.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks = [];
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > 64000) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(Buffer.from(p.value));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString()).data;
    if (!data || typeof data !== "object" || data.disabled === true)
      throw new Error();
    return new Date().toISOString();
  } catch {
    throw new JobError(
      400,
      "The OpenRouter key could not be verified. Check the key, its permissions, expiry and OpenRouter availability.",
    );
  }
}
type Row = {
  id: string;
  runner_id: string;
  payload: any;
  status: string;
  key_verified_at: string | null;
  created_at: string;
  completed_at: string | null;
  result: any;
};
function view(r: Row): ConnectionView {
  return {
    id: r.id,
    runnerId: r.runner_id,
    backend: r.payload.backend,
    action: r.payload.action,
    ...(r.payload.model ? { model: r.payload.model } : {}),
    status: r.status,
    keyVerifiedAt: r.key_verified_at
      ? new Date(r.key_verified_at).toISOString()
      : null,
    createdAt: new Date(r.created_at).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    result: r.result,
  };
}
async function expire(runtime: Runtime, projectId: string) {
  await runtime.database.query(
    "UPDATE qa_model_setup SET status='uncertain',sealed_key=NULL,result='{\"message\":\"Runner check expired or was interrupted. Inspect the runner before requesting a new check; no automatic retry was made.\"}'::jsonb,completed_at=now() WHERE project_id=$1 AND ((status='running' AND claimed_at<now()-interval '2 minutes') OR (status='queued' AND created_at<now()-interval '10 minutes'))",
    [projectId],
  );
}
export async function modelConnections(runtime: Runtime, projectId: string) {
  await expire(runtime, projectId);
  const rows = (
    await runtime.database.query<Row>(
      "SELECT id,runner_id,payload,status,key_verified_at,created_at,completed_at,result FROM qa_model_setup WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30",
      [projectId],
    )
  ).rows;
  const runners = (
    await runtime.database.query<{
      id: string;
      payload: any;
      last_seen: string;
    }>(
      "SELECT id,payload,last_seen FROM qa_runners WHERE project_id=$1 ORDER BY last_seen DESC",
      [projectId],
    )
  ).rows;
  return {
    connections: rows.map(view),
    runners: runners.map((r) => ({
      id: r.id,
      online: runnerOnline(new Date(r.last_seen).toISOString()),
      setupEnabled: Boolean(r.payload.modelSetup),
      fingerprint: r.payload.modelSetup
        ? digest(r.payload.modelSetup.publicKey)
        : null,
      backends: r.payload.modelSetup?.backends || [],
    })),
  };
}
export async function requestModelSetup(
  runtime: Runtime,
  projectId: string,
  body: unknown,
) {
  const parsed = SetupRequest.safeParse(body);
  if (!parsed.success)
    throw new JobError(
      400,
      parsed.error.issues[0]?.message || "Check the model connection fields.",
    );
  const input = parsed.data;
  const runner = (
    await runtime.database.query<{ payload: any; last_seen: string }>(
      "SELECT payload,last_seen FROM qa_runners WHERE project_id=$1 AND id=$2",
      [projectId, input.runnerId],
    )
  ).rows[0];
  if (
    !runner ||
    !runnerOnline(new Date(runner.last_seen).toISOString()) ||
    !runner.payload.modelSetup?.backends?.includes(input.backend)
  )
    throw new JobError(
      409,
      "Connect an online runner with --allow-model-setup and explicitly enroll this backend first.",
    );
  const attempt = await runtime.database.query(
    "INSERT INTO qa_security_limits (id,attempts,expires_at) VALUES ($1,1,now()+interval '1 hour') ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN qa_security_limits.expires_at<=now() THEN 1 ELSE qa_security_limits.attempts+1 END,expires_at=CASE WHEN qa_security_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE qa_security_limits.expires_at END WHERE qa_security_limits.expires_at<=now() OR qa_security_limits.attempts<30 RETURNING id",
    [digest("model-setup:" + projectId)],
  );
  if (!attempt.rows.length)
    throw new JobError(429, "Connection check limit reached. Try again later.");
  const key = publicKey(runner.payload.modelSetup.publicKey),
    fingerprint = digest(runner.payload.modelSetup.publicKey),
    id = randomUUID();
  // Validate over TLS, then persist only a runner-encrypted envelope, never the plaintext key.
  const verified =
    input.backend === "openrouter" && input.action === "configure"
      ? await verifyOpenRouter(input.apiKey!, runtime.connectionFetch)
      : null;
  const { apiKey, consent, ...payload } = input;
  const sealed =
    apiKey !== undefined
      ? publicEncrypt(
          {
            key,
            oaepHash: "sha256",
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepLabel: label(projectId, input.runnerId, id, input.backend),
          },
          Buffer.from(apiKey),
        ).toString("base64")
      : null;
  const c = await runtime.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      projectId,
    ]);
    await expireWithQuery(c.query.bind(c), projectId);
    if (
      (
        await c.query(
          "SELECT id FROM qa_model_setup WHERE project_id=$1 AND status IN ('queued','running')",
          [projectId],
        )
      ).rows.length
    )
      throw new JobError(
        409,
        "Finish the pending connection request before starting another.",
      );
    const recent = await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM qa_model_setup WHERE project_id=$1 AND created_at>now()-interval '1 hour'",
      [projectId],
    );
    if (Number(recent.rows[0].n) >= 30)
      throw new JobError(
        429,
        "Connection check limit reached. Try again later.",
      );
    const result = await c.query<Row>(
      "INSERT INTO qa_model_setup (id,project_id,runner_id,payload,sealed_key,key_verified_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *",
      [
        id,
        projectId,
        input.runnerId,
        JSON.stringify({ ...payload, fingerprint, projectId }),
        sealed,
        verified,
      ],
    );
    await c.query("COMMIT");
    return { connection: view(result.rows[0]) };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function expireWithQuery(
  q: Runtime["database"]["query"],
  project: string,
) {
  await q(
    "UPDATE qa_model_setup SET status='uncertain',sealed_key=NULL,result='{\"message\":\"An earlier request expired. Request a new check after inspecting the runner.\"}'::jsonb,completed_at=now() WHERE project_id=$1 AND ((status='running' AND claimed_at<now()-interval '2 minutes') OR (status='queued' AND created_at<now()-interval '10 minutes'))",
    [project],
  );
}
export async function claimModelSetup(
  runtime: Runtime,
  projectId: string,
  body: unknown,
) {
  const input = z.object({ runnerId: RunnerId }).strict().safeParse(body);
  if (!input.success) throw new JobError(400, "Invalid setup runner.");
  const c = await runtime.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      projectId,
    ]);
    await expireWithQuery(c.query.bind(c), projectId);
    const runner = (
      await c.query<{ payload: any; last_seen: string }>(
        "SELECT payload,last_seen FROM qa_runners WHERE project_id=$1 AND id=$2",
        [projectId, input.data.runnerId],
      )
    ).rows[0];
    if (
      !runner ||
      !runnerOnline(new Date(runner.last_seen).toISOString()) ||
      !runner.payload.modelSetup
    )
      throw new JobError(409, "Model setup is not enrolled on this runner.");
    const r = (
      await c.query<Row>(
        "SELECT * FROM qa_model_setup WHERE project_id=$1 AND runner_id=$2 AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE",
        [projectId, input.data.runnerId],
      )
    ).rows[0];
    if (!r) {
      await c.query("COMMIT");
      return { request: null };
    }
    if (
      r.payload.fingerprint !== digest(runner.payload.modelSetup.publicKey) ||
      !runner.payload.modelSetup.backends.includes(r.payload.backend)
    )
      throw new JobError(
        409,
        "The enrolled runner key or backend changed. Request a new connection check.",
      );
    const token = randomBytes(32).toString("base64url");
    await c.query(
      "UPDATE qa_model_setup SET status='running',claim_hash=$2,claimed_at=now() WHERE id=$1",
      [r.id, digest(token)],
    );
    await c.query("COMMIT");
    return {
      request: { id: r.id, ...r.payload, sealedKey: (r as any).sealed_key },
      claimToken: token,
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const Result = z
  .object({
    message: z.string().max(300),
    models: z
      .array(z.object({ id: z.string().max(160) }).strict())
      .max(100)
      .optional(),
    credentialPresent: z.boolean().optional(),
    inferencePassed: z.boolean().optional(),
    endpoint: z.string().max(120).optional(),
  })
  .strict();
export async function completeModelSetup(
  runtime: Runtime,
  projectId: string,
  id: string,
  body: unknown,
) {
  const parsed = z
    .object({
      runnerId: RunnerId,
      claimToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      status: z.enum(["passed", "failed", "uncertain"]),
      result: Result,
    })
    .strict()
    .safeParse(body);
  if (!parsed.success) throw new JobError(400, "Invalid connection result.");
  const input = parsed.data;
  const r = await runtime.database.query(
    "UPDATE qa_model_setup SET status=$5,result=$6::jsonb,sealed_key=NULL,completed_at=now() WHERE project_id=$1 AND id=$2 AND runner_id=$3 AND claim_hash=$4 AND status='running' AND claimed_at>now()-interval '2 minutes' RETURNING id",
    [
      projectId,
      id,
      input.runnerId,
      digest(input.claimToken),
      input.status,
      JSON.stringify(input.result),
    ],
  );
  if (!r.rows.length)
    throw new JobError(
      409,
      "This connection claim expired or was already completed.",
    );
  return { ok: true };
}
