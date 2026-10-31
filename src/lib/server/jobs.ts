import {hostedAdmission} from './capacity';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hostedLimits} from './operations';
import {canonical} from '../quality';
import {planSnapshot,policyFor} from './quality';
import { audit, queueNotification, resultSummary } from "./team";
import { sameSubject } from "../targets";
import { enabledUnitTests } from "./test-cases";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AckSchema, JobInputSchema, JobRequestSchema, LeaseSchema, TestingProfileSchema, jobReportMatches, runnerOnline, testingDefaults, type Job, type JobInput, type Runner } from "../jobs";
import type { RunInput, Settings } from "../contracts";
import type { Database } from "./database";
import { z } from "zod";

export class JobError extends Error { constructor(public status: number, message: string) { super(message); } }
export type QueueProject = { id: string; repository: string; settings: Settings; testing_profile?: unknown; runner?: Runner | null; agent_last_seen: Date | string | null; max_parallel?: number; execution_mode?: string };
type Row = { id: string; payload: JobInput; status: Job["status"]; attempts: number; runner_id: string | null; lease_hash: string | null; lease_expires_at: Date | string | null; message: string; record_id: string | null; created_at: Date | string; updated_at: Date | string };
const iso = (v: Date | string) => new Date(v).toISOString();
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new JobError(400, "Invalid job request, trusted expectations, or runner lease."); return result.data; }
function view(row: Row): Job { return { ...row.payload, status: row.status, attempts: row.attempts, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null, message: row.message, recordId: row.record_id }; }
async function transaction<T>(database: Database, projectId: string, action: (q: Database["query"]) => Promise<T>) {
  const c = await database.connect();
  try { await c.query("BEGIN"); await c.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [projectId]); const result = await action(c.query.bind(c)); await c.query("COMMIT"); return result; }
  catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
async function expire(q: Database["query"], projectId: string) {
  const expired=await q<Row>("UPDATE qa_jobs SET status = 'blocked', message = 'Runner lease expired. Check the runner before explicitly retrying; paid work may already have started.', lease_hash = NULL, lease_expires_at = NULL, updated_at = now() WHERE project_id = $1 AND status = 'running' AND lease_expires_at <= now() RETURNING *", [projectId]);
  for(const row of expired.rows){await audit(q,projectId,'Runner','qa.lease_expired',row.id);await queueNotification(q,projectId,'blocked',`${row.id}:expired:${row.attempts}`,notificationPayload({repository:row.payload.repository},row.payload,{message:row.message}));}
}
export async function listJobs(database: Database, projectId: string) {
  await expire(database.query.bind(database), projectId);
  const result = await database.query<Row>("SELECT * FROM qa_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100", [projectId]);
  return result.rows.map(view);
}
export async function createJob(database: Database, project: QueueProject, body: unknown, requestedBy?: string, options:{recoverUnstarted?:boolean}={}) {
  const input = parse(JobRequestSchema, body);
  return transaction(database, project.id, async q => {
    const prior = await q<Row>("SELECT * FROM qa_jobs WHERE project_id = $1 AND dedupe_key = $2", [project.id, input.dedupeKey]);
    if (prior.rows[0]) {
      if (!sameSubject(prior.rows[0].payload, input.target ? { target: input.target } : { pr: { number: input.prNumber! } }) || prior.rows[0].payload.revision !== input.revision.toLowerCase()) throw new JobError(409, "An idempotency key cannot change the PR or revision.");
      if(!(options.recoverUnstarted&&prior.rows[0].status==='blocked'&&prior.rows[0].attempts===0))return { job: view(prior.rows[0]), duplicate: true };
    }
    const recovering=prior.rows[0];
    await expire(q, project.id);
    const count = await q<{ total: string; active: string }>("SELECT count(*) AS total, count(*) FILTER (WHERE status IN ('queued','running')) AS active FROM qa_jobs WHERE project_id = $1", [project.id]);
    if (Number(count.rows[0].active) >= 20 || Number(count.rows[0].total) >= 1000) throw new JobError(409, "The project job queue or history limit has been reached.");
    const hosted=project.execution_mode==='hosted' && project.settings.backend==='openrouter';
    if(input.githubBuild&&(!hosted||!input.target))throw new JobError(400,'Automatic GitHub build provenance requires a hosted build/release assessment.');
    const capacity=hosted?await hostedAdmission(q,project.id):{mode:'legacy' as const};
    if(hosted&&capacity.mode==='legacy'){
      await q('LOCK TABLE qa_jobs IN SHARE ROW EXCLUSIVE MODE');
      await q("UPDATE qa_jobs SET status='blocked',message='Hosted worker expired or startup was interrupted. Review the prior attempt and request a new run; no automatic retry was made.',lease_expires_at=NULL,updated_at=now() WHERE execution_mode='hosted' AND ((status='running' AND lease_expires_at<=now()) OR (status='queued' AND created_at<now()-interval '5 minutes'))");
      const usage=(await q<{monthly:string;active:string}>("SELECT count(*) FILTER (WHERE created_at>=date_trunc('month',now()) AND (status IN ('queued','running','completed') OR attempts>0)) AS monthly,count(*) FILTER (WHERE status IN ('queued','running')) AS active FROM qa_jobs WHERE execution_mode='hosted'",[])).rows[0];
      const tenant=(await q<{n:string}>("SELECT count(*) AS n FROM qa_jobs WHERE project_id=$1 AND execution_mode='hosted' AND status IN ('queued','running')",[project.id])).rows[0];if(Number(tenant.n)>=Math.min(project.max_parallel||1,hostedLimits.globalActive))throw new JobError(409,'This project already has its allowed hosted assessments active; no duplicate paid work was started.');
      if(Number(usage.monthly)>=hostedLimits.monthlyAssessments||Number(usage.active)>=hostedLimits.globalActive)throw new JobError(409,'Hosted worker capacity or the shared monthly pilot allowance is full. No paid work was started.');
    }
    const qualityPlan=await planSnapshot(q,project.id),policy=await policyFor(q,project.id);
    await admitPolicy(q,project.id,project.settings);
    const profile = parse(TestingProfileSchema, project.testing_profile || testingDefaults);
    if(recovering&&(canonical(recovering.payload.settings)!==canonical(project.settings)||canonical(recovering.payload.testingProfile)!==canonical(profile)||canonical(recovering.payload.unitTests||[])!==canonical(await enabledUnitTests(q,project.id))||recovering.payload.qualityPlan&&recovering.payload.qualityPlan.digest!==qualityPlan.digest||!recovering.payload.qualityPlan&&(qualityPlan.brief||qualityPlan.requirements.length)))throw new JobError(409,'This unstarted job retains different frozen inputs. A new automatic event must use the current configuration.');
    const payload = recovering?recovering.payload:parse(JobInputSchema, { schemaVersion: 1, id: randomUUID(), ...(input.githubBuild?{githubBuild:input.githubBuild}:{}), ...(input.hostedArtifactUrl?{hostedArtifactUrl:input.hostedArtifactUrl}:{}), ...((qualityPlan.requirements.length||qualityPlan.brief)?{qualityPlan}:{}), ...(requestedBy ? {requestedBy:requestedBy.slice(0,100)} : {}), repository: project.repository, ...(input.target ? { target: input.target } : { pr: { number: input.prNumber } }), unitTests: await enabledUnitTests(q, project.id), revision: input.revision.toLowerCase(), base: profile.baseRef, settings: project.settings, testingProfile: profile });
    const available=(await q<{payload:Runner;last_seen:Date|string}>('SELECT payload,last_seen FROM qa_runners WHERE project_id=$1',[project.id])).rows;
    const compatible=available.filter(r=>runnerOnline(iso(r.last_seen))).map(r=>r.payload).find(r=>runnerFits(r,payload));
    const browserRequired = !input.target || input.target.platform === "web";
    const hostedMissing = hosted ? !(await q("SELECT project_id FROM qa_provider_credentials WHERE project_id=$1 AND provider='openrouter'",[project.id])).rows.length ? 'Connect your OpenRouter key in Models & agents; no connector is required.' : input.target && input.target.platform!=='web' ? 'Hosted QA currently runs web previews. This native/API platform needs an optional enrolled runner.' : input.target&&!input.hostedArtifactUrl ? 'Provide a public immutable artifact URL and its SHA-256 for hosted build/release QA.' : profile.visualRegression&&!policy.allowEvidenceUploads ? 'Enable redacted evidence uploads in the quality policy to retain and review hosted visual candidates.' : '' : '';
    const missing = hostedMissing || (policy.requirePlanForRelease&&input.target&&(!qualityPlan.requirements.length||qualityPlan.requirements.some(r=>['critical','high'].includes(r.risk)&&!r.checkIds.length&&!r.goalIds.length)) ? 'Map the active critical/high requirements to explicit checks or goals before release testing.' : input.target?.platform === "web" && profile.previewUrlTemplate.includes("{pr}") ? "Save a build/release preview URL without a PR placeholder; use a fixed staging origin or {sha}." : !hosted && input.target && !(compatible || project.runner)?.platforms?.includes(input.target.platform) ? "Enroll this build/release platform and its builder manifest on the local runner." : !hosted && payload.unitTests?.length && !(compatible || project.runner)?.workspaceTests ? "Enroll authored unit tests on the local runner before requesting this run." : browserRequired && !profile.previewUrlTemplate ? "Save a preview URL in Testing setup before retrying." : browserRequired && !profile.goals.goals.length ? "Add at least one explicit trusted goal and assertion in Testing setup before retrying." : project.settings.roles.some(role => !project.settings.roleModels[role] && !project.settings.model) ? "Select models for each QA role, then request a new run." : !hosted && !compatible ? "An enrolled ready runner compatible with this job must be online before retrying." : "");
    // A blocked request is still durable and visible. Profile changes need a new request to preserve immutable input.
    const result = recovering?await q<Row>("UPDATE qa_jobs SET status=$3,message=$4,updated_at=now() WHERE id=$1 AND project_id=$2 AND attempts=0 AND status='blocked' RETURNING *",[recovering.id,project.id,missing?'blocked':'queued',missing||'Configuration recovered; this unstarted assessment was queued automatically.']):await q<Row>("INSERT INTO qa_jobs (id, project_id, dedupe_key, payload, status, message,execution_mode) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING *", [payload.id, project.id, input.dedupeKey, JSON.stringify(payload), missing ? "blocked" : "queued", missing, hosted?"hosted":"self-hosted"]);
    if(capacity.mode==='fair'){const updated=await q<Row>("UPDATE qa_jobs SET capacity_mode='fair',queue_expires_at=now()+$2*interval '1 minute',message=CASE WHEN status='queued' THEN 'Awaiting fair hosted capacity; no provider work has started.' ELSE message END WHERE id=$1 RETURNING *",[payload.id,capacity.queueTimeout]);result.rows[0]=updated.rows[0];}
    const rollout=(await q('SELECT version,payload FROM qa_assurance_policy WHERE project_id=$1',[project.id])).rows[0]||{version:0,payload:{mode:'advisory'}};
    await q('UPDATE qa_jobs SET execution_context=COALESCE(execution_context,$2::jsonb) WHERE id=$1 AND project_id=$3',[payload.id,JSON.stringify({schemaVersion:1,tools:{engineRevision:hosted?(await readFile(join(process.cwd(),'scripts/hosted-engine-revision.txt'),'utf8')).trim():null,executionMode:hosted?'hosted':'enrolled-runner',limitation:'Enrolled-runner engine/model provider build versions are not independently attested.'},repository:payload.repository,revision:payload.revision,subject:payload.target||payload.pr,qualityPlan:payload.qualityPlan||null,qualityPolicy:policy,rollout,testingProfile:payload.testingProfile,unitTests:payload.unitTests||[],modelSettings:payload.settings,selection:{strategy:'all-configured',rationale:'Execute the complete approved goal matrix and enabled unit tests; critical regression is retained. Code changes inform diagnosis but do not remove required checks.',limitations:['No inferred business intent is accepted automatically.','No claim of whole-product or code-line coverage.']},capturedAt:new Date().toISOString(),source:recovering?'unstarted-job-recovery':'job-admission'}),project.id]);
    await audit(q,project.id,requestedBy || 'Project member','qa.requested',`${payload.target?.kind || 'PR'} ${payload.target?.name || payload.pr?.number} · ${payload.revision}`);
    await queueNotification(q,project.id,missing ? 'blocked' : 'queued',`${payload.id}:queued`,notificationPayload(project,payload,{message:missing}));
    return { job: view(result.rows[0]), duplicate: Boolean(recovering) };
  });
}
export async function admitPolicy(q:Database['query'],projectId:string,settings:Settings,excludeId?:string){const policy=await policyFor(q,projectId);if(!policy.allowedBackends.includes(settings.backend)||policy.approvedModels.length&&[settings.model,...Object.values(settings.roleModels)].filter(Boolean).some(m=>!policy.approvedModels.includes(m!)))throw new JobError(403,'The selected backend or model is outside the current approved model policy.');if(policy.requireRepoVerification&&!(await q("SELECT project_id FROM qa_repository_authorizations WHERE project_id=$1 AND verified_at>now()-interval '7 days' AND owner_id=(SELECT owner_id FROM projects WHERE id=$1)",[projectId])).rows.length)throw new JobError(403,'Fresh repository authorization is required by this project policy.');const committed=(await q<{usd:string}>("SELECT COALESCE(sum((payload->'settings'->>'maxCostUsd')::numeric*greatest(attempts,1)),0) AS usd FROM qa_jobs WHERE project_id=$1 AND ($2::text IS NULL OR id<>$2) AND created_at>=date_trunc('month',now()) AND (status IN ('queued','running','completed') OR attempts>0)",[projectId,excludeId||null])).rows[0];if(Number(committed.usd)+settings.maxCostUsd>policy.monthlyInferenceBudgetUsd)throw new JobError(409,'Monthly reserved inference budget would be exceeded. Review committed work or change the owner policy deliberately.');}
export async function changeJob(database: Database, project: QueueProject, id: string, action: "retry" | "cancel", actor = "Project member") {
  return transaction(database, project.id, async q => {
    await expire(q, project.id);
    const found = await q<Row>("SELECT * FROM qa_jobs WHERE id = $1 AND project_id = $2", [id, project.id]);
    const row = found.rows[0]; if (!row) throw new JobError(404, "Job not found.");
    if (action === "cancel") {
      if (!["queued", "running", "blocked"].includes(row.status)) throw new JobError(409, "This job cannot be cancelled.");
      const result = await q<Row>("UPDATE qa_jobs SET status='cancelled', message='Cancelled by project owner.', lease_hash=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1 RETURNING *", [id]);
      await audit(q,project.id,actor,'qa.cancelled',id);
      await queueNotification(q,project.id,'cancelled',`${id}:cancelled`,notificationPayload(project,row.payload));
      return view(result.rows[0]);
    }
    if ((row as Row & {execution_mode?:string}).execution_mode==='hosted') throw new JobError(409,'Request a new hosted run after reviewing the blocked reason. A new request keeps prior compute and inference costs visible.');
    if (!["blocked", "failed"].includes(row.status) || row.attempts >= 3) throw new JobError(409, "Only blocked or failed jobs below three attempts can be retried.");
    if ((!row.payload.target || row.payload.target.platform === "web") && (!row.payload.testingProfile.previewUrlTemplate || !row.payload.testingProfile.goals.goals.length) || row.payload.settings.roles.some(role => !row.payload.settings.roleModels[role] && !row.payload.settings.model)) throw new JobError(409, "This immutable job lacks preview expectations or model selection. Save the configuration and request a new run.");
    if (!project.runner?.ready || !runnerOnline(project.agent_last_seen ? iso(project.agent_last_seen) : null)) throw new JobError(409, "Connect an enrolled ready runner before retrying.");
    const count = await q<{ count: string }>("SELECT count(*) AS count FROM qa_jobs WHERE project_id=$1 AND status IN ('queued','running')", [project.id]);
    if (Number(count.rows[0].count) >= 20) throw new JobError(409, "The project job queue is full.");
    await admitPolicy(q,project.id,{...row.payload.settings,maxCostUsd:row.payload.settings.maxCostUsd*(row.attempts+1)},row.id);
    const result = await q<Row>("UPDATE qa_jobs SET status='queued', message='Explicit retry requested; the runner must resume its existing job evidence.', lease_hash=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1 RETURNING *", [id]);
    await audit(q,project.id,actor,'qa.retried',id);
    await queueNotification(q,project.id,'queued',`${id}:retry:${row.attempts}`,notificationPayload(project,row.payload));
    return view(result.rows[0]);
  });
}
export function runnerFits(runner:Runner,job:JobInput) {
  const browser=!job.target || job.target.platform==='web';
  return (!job.testingProfile.goals.goals.some(g=>g.assertions.some(a=>a.action==='expectApi'||a.action==='expectFocused'))||runner.apiAssertions===true) && runner.ready && runner.executeJobs && (!job.qualityPlan||runner.qualityPlans===true) && runner.backends.includes(job.settings.backend) && (!job.target || !!runner.platforms?.includes(job.target.platform)) && (!job.unitTests?.length || runner.workspaceTests===true) && (!browser || job.testingProfile.browsers.every(b=>runner.browsers.includes(b)) && job.testingProfile.maxPages<=runner.maxPages) && job.settings.maxCostUsd<=runner.maxCostUsd && job.settings.maxCallsPerRun<=runner.maxCallsPerRun;
}
function notificationPayload(project:{repository:string},job:JobInput,extra:Record<string,unknown>={}) {return {repository:project.repository,revision:job.revision,...(job.target ? {target:job.target}:{pr:job.pr}),requestedBy:job.requestedBy,jobId:job.id,...extra};}
export async function claimJob(database: Database, project: QueueProject, body: unknown) {
  const { runnerId } = parse(z.object({ runnerId: z.string().regex(/^[a-f0-9]{32,64}$/) }).strict(), body);
  return transaction(database, project.id, async q => {
    await expire(q, project.id);
    const enrolled=(await q<{payload:Runner;last_seen:Date|string}>('SELECT payload,last_seen FROM qa_runners WHERE project_id=$1 AND id=$2',[project.id,runnerId])).rows[0];
    if(!enrolled || !runnerOnline(iso(enrolled.last_seen)) || !enrolled.payload.ready || !enrolled.payload.executeJobs) throw new JobError(409,'This runner is not currently enrolled and online.');
    const running = await q<{runner_id:string}>("SELECT runner_id FROM qa_jobs WHERE project_id=$1 AND status='running'",[project.id]);
    const capacity=(await q<{max_parallel:number}>('SELECT max_parallel FROM projects WHERE id=$1',[project.id])).rows[0].max_parallel;
    if(running.rows.length>=capacity || running.rows.some(r=>r.runner_id===runnerId))return {job:null};
    const candidates=await q<Row>("SELECT * FROM qa_jobs WHERE project_id=$1 AND status='queued' AND attempts<3 AND execution_mode='self-hosted' ORDER BY created_at,id LIMIT 20 FOR UPDATE",[project.id]);
    const permitted:Row[]=[];for(const row of candidates.rows){try{await admitPolicy(q,project.id,{...row.payload.settings,maxCostUsd:row.payload.settings.maxCostUsd*(row.attempts+1)},row.id);if(runnerFits(enrolled.payload,row.payload))permitted.push(row);}catch(e){if(!(e instanceof JobError))throw e;await q("UPDATE qa_jobs SET status='blocked',message=$3,updated_at=now() WHERE project_id=$1 AND id=$2",[project.id,row.id,'Project policy or reserved budget changed. Inspect settings before retrying.']);await audit(q,project.id,'Policy','qa.policy_blocked',row.id);}}
    const next={rows:permitted.slice(0,1)};
    if (!next.rows.length) return { job: null };
    const leaseToken = randomBytes(32).toString("base64url");
    const result = await q<Row>("UPDATE qa_jobs SET status='running', attempts=attempts+1, runner_id=$2, lease_hash=$3, lease_expires_at=now()+interval '5 minutes', message='', updated_at=now() WHERE id=$1 RETURNING *", [next.rows[0].id, runnerId, tokenHash(leaseToken)]);
    await audit(q,project.id,'Runner','qa.started',next.rows[0].id);
    await queueNotification(q,project.id,'started',`${next.rows[0].id}:started:${result.rows[0].attempts}`,notificationPayload(project,next.rows[0].payload));
    return { job: result.rows[0].payload, leaseToken, leaseExpiresAt: iso(result.rows[0].lease_expires_at!), attempt: result.rows[0].attempts };
  });
}
export async function updateLease(database: Database, projectId: string, id: string, body: unknown, complete = false, runtime?: import('./runtime').Runtime) {
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
    let summary:Record<string,unknown>={};
    if (ack.status === "completed") {
      const report = await q<{ payload: RunInput }>("SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2", [projectId, ack.recordId]);
      if (!report.rows[0] || !jobReportMatches(row.payload, report.rows[0].payload)) throw new JobError(409, "Upload a report bound to this exact repository, PR, and revision before completion.");
      if(runtime){await q('UPDATE qa_jobs SET record_id=$2 WHERE id=$1',[id,ack.recordId]);const {triageAssessment}=await import('./automatic-triage');const {archiveAssessment}=await import('./assessment-ledger');await archiveAssessment(runtime,q,projectId,report.rows[0].payload);await triageAssessment(runtime,q,projectId,report.rows[0].payload,id,row.payload);}
      summary=resultSummary(report.rows[0].payload);
    }
    const result = await q<Row>("UPDATE qa_jobs SET status=$2, record_id=$3, message=$4, lease_expires_at=NULL, updated_at=now() WHERE id=$1 RETURNING *", [id, ack.status, ack.recordId || null, ack.message]);
    await audit(q,projectId,'Runner',`qa.${ack.status}`,id);
    await queueNotification(q,projectId,ack.status==='completed'?'completed':'blocked',`${id}:complete:${row.attempts}`,notificationPayload({repository:row.payload.repository},row.payload,{...summary,message:ack.message}));
    return { job: view(result.rows[0]), duplicate: false };
  });
}
