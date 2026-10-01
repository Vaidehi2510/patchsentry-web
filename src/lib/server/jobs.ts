import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AckSchema, JobInputSchema, JobRequestSchema, LeaseSchema, TestingProfileSchema, jobReportMatches, runnerOnline, testingDefaults, type Job, type JobInput, type Runner } from "../jobs";
import type { RunInput, Settings } from "../contracts";
import type { Database } from "./database";
import { z } from "zod";

export class JobError extends Error { constructor(public status: number, message: string) { super(message); } }
export type QueueProject = { id: string; repository: string; settings: Settings; testing_profile?: unknown; runner?: Runner | null; agent_last_seen: Date | string | null };
type Row = { id: string; payload: JobInput; status: Job["status"]; attempts: number; runner_id: string | null; lease_hash: string | null; lease_expires_at: Date | string | null; message: string; record_id: string | null; created_at: Date | string; updated_at: Date | string };
const iso = (v: Date | string) => new Date(v).toISOString();
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new JobError(400, "Invalid job request, trusted expectations, or runner lease."); return result.data; }
function view(row: Row): Job { return { ...row.payload, status: row.status, attempts: row.attempts, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null, message: row.message, recordId: row.record_id }; }
async function transaction<T>(database: Database, projectId: string, action: (q: Database["query"]) => Promise<T>) {
  const c = await database.connect();
  try { await c.query("BEGIN"); await c.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [projectId]); const result = await action(c.query); await c.query("COMMIT"); return result; }
  catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
async function expire(q: Database["query"], projectId: string) {
  await q("UPDATE qa_jobs SET status = 'blocked', message = 'Runner lease expired. Check the runner before explicitly retrying; paid work may already have started.', lease_hash = NULL, lease_expires_at = NULL, updated_at = now() WHERE project_id = $1 AND status = 'running' AND lease_expires_at <= now()", [projectId]);
}
export async function listJobs(database: Database, projectId: string) {
  await expire(database.query.bind(database), projectId);
  const result = await database.query<Row>("SELECT * FROM qa_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100", [projectId]);
  return result.rows.map(view);
}
export async function createJob(database: Database, project: QueueProject, body: unknown) {
  const input = parse(JobRequestSchema, body);
  return transaction(database, project.id, async q => {
    const prior = await q<Row>("SELECT * FROM qa_jobs WHERE project_id = $1 AND dedupe_key = $2", [project.id, input.dedupeKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].payload.pr.number !== input.prNumber || prior.rows[0].payload.revision !== input.revision.toLowerCase()) throw new JobError(409, "An idempotency key cannot change the PR or revision.");
      return { job: view(prior.rows[0]), duplicate: true };
    }
    await expire(q, project.id);
    const count = await q<{ total: string; active: string }>("SELECT count(*) AS total, count(*) FILTER (WHERE status IN ('queued','running')) AS active FROM qa_jobs WHERE project_id = $1", [project.id]);
    if (Number(count.rows[0].active) >= 20 || Number(count.rows[0].total) >= 1000) throw new JobError(409, "The project job queue or history limit has been reached.");
    const profile = parse(TestingProfileSchema, project.testing_profile || testingDefaults);
    const payload = parse(JobInputSchema, { schemaVersion: 1, id: randomUUID(), repository: project.repository, pr: { number: input.prNumber }, revision: input.revision.toLowerCase(), base: profile.baseRef, settings: project.settings, testingProfile: profile });
    const missing = !profile.previewUrlTemplate ? "Save a preview URL in Testing setup before retrying." : !profile.goals.goals.length ? "Add at least one explicit trusted goal and assertion in Testing setup before retrying." : project.settings.roles.some(role => !project.settings.roleModels[role] && !project.settings.model) ? "Select models for each QA role, then request a new run." : !project.runner?.ready || !runnerOnline(project.agent_last_seen ? iso(project.agent_last_seen) : null) ? "An enrolled ready runner must be online before retrying." : "";
    // A blocked request is still durable and visible. Profile changes need a new request to preserve immutable input.
    const result = await q<Row>("INSERT INTO qa_jobs (id, project_id, dedupe_key, payload, status, message) VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *", [payload.id, project.id, input.dedupeKey, JSON.stringify(payload), missing ? "blocked" : "queued", missing]);
    return { job: view(result.rows[0]), duplicate: false };
  });
}
export async function changeJob(database: Database, project: QueueProject, id: string, action: "retry" | "cancel") {
  return transaction(database, project.id, async q => {
    await expire(q, project.id);
    const found = await q<Row>("SELECT * FROM qa_jobs WHERE id = $1 AND project_id = $2", [id, project.id]);
    const row = found.rows[0]; if (!row) throw new JobError(404, "Job not found.");
    if (action === "cancel") {
      if (!["queued", "running", "blocked"].includes(row.status)) throw new JobError(409, "This job cannot be cancelled.");
      const result = await q<Row>("UPDATE qa_jobs SET status='cancelled', message='Cancelled by project owner.', lease_hash=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1 RETURNING *", [id]);
      return view(result.rows[0]);
    }
    if (!["blocked", "failed"].includes(row.status) || row.attempts >= 3) throw new JobError(409, "Only blocked or failed jobs below three attempts can be retried.");
    if (!row.payload.testingProfile.previewUrlTemplate || !row.payload.testingProfile.goals.goals.length || row.payload.settings.roles.some(role => !row.payload.settings.roleModels[role] && !row.payload.settings.model)) throw new JobError(409, "This immutable job lacks preview expectations or model selection. Save the configuration and request a new run.");
    if (!project.runner?.ready || !runnerOnline(project.agent_last_seen ? iso(project.agent_last_seen) : null)) throw new JobError(409, "Connect an enrolled ready runner before retrying.");
    const count = await q<{ count: string }>("SELECT count(*) AS count FROM qa_jobs WHERE project_id=$1 AND status IN ('queued','running')", [project.id]);
    if (Number(count.rows[0].count) >= 20) throw new JobError(409, "The project job queue is full.");
    const result = await q<Row>("UPDATE qa_jobs SET status='queued', message='Explicit retry requested; the runner must resume its existing job evidence.', lease_hash=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1 RETURNING *", [id]);
    return view(result.rows[0]);
  });
}
export async function claimJob(database: Database, project: QueueProject, body: unknown) {
  const { runnerId } = parse(z.object({ runnerId: z.string().regex(/^[a-f0-9]{32,64}$/) }).strict(), body);
  if (!project.runner?.ready || !project.runner.executeJobs || project.runner.id !== runnerId || !runnerOnline(project.agent_last_seen ? iso(project.agent_last_seen) : null)) throw new JobError(409, "This project has no matching online enrolled runner.");
  return transaction(database, project.id, async q => {
    await expire(q, project.id);
    const running = await q("SELECT id FROM qa_jobs WHERE project_id=$1 AND status='running'", [project.id]);
    if (running.rows.length) return { job: null };
    const next = await q<Row>("SELECT * FROM qa_jobs WHERE project_id=$1 AND status='queued' AND attempts<3 ORDER BY created_at,id LIMIT 1 FOR UPDATE", [project.id]);
    if (!next.rows.length) return { job: null };
    const leaseToken = randomBytes(32).toString("base64url");
    const result = await q<Row>("UPDATE qa_jobs SET status='running', attempts=attempts+1, runner_id=$2, lease_hash=$3, lease_expires_at=now()+interval '5 minutes', message='', updated_at=now() WHERE id=$1 RETURNING *", [next.rows[0].id, runnerId, tokenHash(leaseToken)]);
    return { job: result.rows[0].payload, leaseToken, leaseExpiresAt: iso(result.rows[0].lease_expires_at!), attempt: result.rows[0].attempts };
  });
}
export async function updateLease(database: Database, projectId: string, id: string, body: unknown, complete = false) {
  const input = complete ? parse(AckSchema, body) : parse(LeaseSchema, body);
  // Expiry must survive rejecting a stale lease; do not roll it back with that request.
  await expire(database.query.bind(database), projectId);
  return transaction(database, projectId, async q => {
    const found = await q<Row>("SELECT * FROM qa_jobs WHERE id=$1 AND project_id=$2", [id, projectId]);
    const row = found.rows[0]; if (!row) throw new JobError(404, "Job not found.");
    if (row.runner_id !== input.runnerId || row.lease_hash !== tokenHash(input.leaseToken)) throw new JobError(409, "The job lease is stale or belongs to another runner.");
    if (!complete) {
      if (row.status !== "running") throw new JobError(409, "This job is no longer running.");
      const result = await q<Row>("UPDATE qa_jobs SET lease_expires_at=now()+interval '5 minutes', updated_at=now() WHERE id=$1 RETURNING *", [id]);
      return { leaseExpiresAt: iso(result.rows[0].lease_expires_at!) };
    }
    const ack = parse(AckSchema, input);
    if (row.status !== "running") {
      if (row.status === ack.status && row.record_id === (ack.recordId || null)) return { job: view(row), duplicate: true };
      throw new JobError(409, "This job was already acknowledged.");
    }
    if (ack.status === "completed") {
      const report = await q<{ payload: RunInput }>("SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2", [projectId, ack.recordId]);
      if (!report.rows[0] || !jobReportMatches(row.payload, report.rows[0].payload)) throw new JobError(409, "Upload a report bound to this exact repository, PR, and revision before completion.");
    }
    const result = await q<Row>("UPDATE qa_jobs SET status=$2, record_id=$3, message=$4, lease_expires_at=NULL, updated_at=now() WHERE id=$1 RETURNING *", [id, ack.status, ack.recordId || null, ack.message]);
    return { job: view(result.rows[0]), duplicate: false };
  });
}
