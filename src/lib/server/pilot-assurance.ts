import {planSnapshot} from './quality';
import {enabledUnitTests} from './test-cases';
import {TestingProfileSchema,testingDefaults} from '../jobs';
import {currentVisualDigest} from './visual-baselines';
import {executionEvidenceReasons} from '../execution-evidence';
import {retainedEvidenceChecks} from './evidence';
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Runtime } from "./runtime";
import { canonical } from "../quality";
import { archiveAssessment, appendLedger, assessmentDigest } from "./assessment-ledger";
import { JobError } from "./jobs";
const sha = z.string().regex(/^[a-f0-9]{64}$/),
  hash = (v: string) => createHash("sha256").update(v).digest("hex");
const Case = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    expected: z.enum(["defect", "clean", "identity-block"]),
    checkId: z.string().min(1).max(160),
    defectId:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
    scenario:z.enum(['ui','api-data','permission','async','infrastructure','identity','other']).default('other'),
    requirement: z.string().min(1).max(1000),
  })
  .strict();
const Suite = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["controlled", "production"]),
    partition:z.enum(["development","held-out"]).default("development"),
    repository: z.string().max(201),
    revision: z.string().regex(/^[a-f0-9]{40,64}$/),
    cases: z
      .array(Case)
      .min(1)
      .max(200)
      .refine((v) => new Set(v.map((c) => c.id)).size === v.length),
    limitations: z.array(z.string().max(600)).max(20).default([]),
  })
  .strict();
export const AssurancePolicy = z
  .object({
    mode: z.enum(["advisory", "enforced"]),
    minCases: z.number().int().min(20).max(1000),
    minAssessments: z.number().int().min(5).max(100),
    minRecall: z.number().min(0.9).max(1),
    maxFalseAlarmRate: z.number().min(0).max(0.1),
    minReliability: z.number().min(0.95).max(1),
    maxKnownInferenceUsd: z.number().min(0).max(10000),
    requireKnownCosts: z.boolean(),
    requireHeldOut: z.boolean().default(false),
    requireArchiveAcknowledgment: z.boolean().default(false),
    requireRetainedEvidence: z.boolean().default(false),
    requiredEvidence: z
      .array(z.enum(["sso", "offboarding", "devices", "security-review"]))
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
const defaults = {
  mode: "advisory" as const,
  minCases: 20,
  minAssessments: 5,
  minRecall: 0.95,
  maxFalseAlarmRate: 0.05,
  minReliability: 0.95,
  maxKnownInferenceUsd: 100,
  requireKnownCosts: true,
  requireHeldOut: false,
  requireArchiveAcknowledgment: false,
  requireRetainedEvidence: false,
  requiredEvidence: ["security-review"] as (
    "security-review" | "sso" | "offboarding" | "devices"
  )[],
  expectedVersion: 0,
};
export async function createPilot(
  r: Runtime,
  id: string,
  body: unknown,
  actor: string,
) {
  const input = Suite.safeParse(body);
  if (!input.success)
    throw new JobError(
      400,
      "Register distinct labeled cases, expected behavior, check IDs and a pinned source revision.",
    );
  const p = (
    await r.database.query<{ repository: string }>(
      "SELECT repository FROM projects WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (input.data.repository.toLowerCase() !== p.repository.toLowerCase())
    throw new JobError(409, "Pilot repository must match this product.");
  const suiteId = randomUUID();
  await r.database.query(
    "INSERT INTO qa_pilot_suites(id,project_id,name,kind,payload,author_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
    [
      suiteId,
      id,
      input.data.name,
      input.data.kind,
      JSON.stringify(input.data),
      actor,
    ],
  );
  return { id: suiteId };
}
export async function reviewPilot(
  r: Runtime,
  id: string,
  suiteId: string,
  actor: string,
) {
  const c = await r.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [id]);
    const row = (
      await c.query<{ author_id: string }>(
        "SELECT author_id FROM qa_pilot_suites WHERE project_id=$1 AND id=$2",
        [id, suiteId],
      )
    ).rows[0];
    if (!row) throw new JobError(404, "Pilot unavailable.");
    if (row.author_id === actor)
      throw new JobError(
        403,
        "A different QA engineer, admin or owner must review the labels before execution.",
      );
    if (
      (
        await c.query(
          "SELECT case_id FROM qa_pilot_observations WHERE suite_id=$1 LIMIT 1",
          [suiteId],
        )
      ).rows.length
    )
      throw new JobError(409, "Ground-truth review must precede execution.");
    await c.query(
      "UPDATE qa_pilot_suites SET reviewer_id=$3,reviewed_at=now() WHERE project_id=$1 AND id=$2",
      [id, suiteId, actor],
    );
    await appendLedger(
      r,
      c.query.bind(c),
      id,
      "pilot-review",
      "pilot-review:" + suiteId,
      { suiteId, reviewer: actor },
      actor,
    );
    await c.query("COMMIT");
    return { reviewed: true };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function observePilot(
  r: Runtime,
  id: string,
  suiteId: string,
  body: unknown,
) {
  const input = z
    .object({ caseId: z.string().max(80), recordId: sha })
    .strict()
    .safeParse(body);
  if (!input.success)
    throw new JobError(
      400,
      "Link a labeled case to an exact retained assessment record.",
    );
  const c = await r.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [id]);
    const suite = (
        await c.query<{
          payload: z.infer<typeof Suite>;
          kind: string;
          reviewer_id: string | null;
          reviewed_at: string | null;
          created_at: string;
        }>(
          "SELECT * FROM qa_pilot_suites WHERE project_id=$1 AND id=$2 FOR UPDATE",
          [id, suiteId],
        )
      ).rows[0],
      run = (
        await c.query<{
          payload: any;
          created_at: string;
          report_digest: string;
        }>(
          "SELECT payload,created_at,encode(sha256(convert_to(payload::text,'UTF8')),'hex') AS report_digest FROM qa_runs WHERE project_id=$1 AND record_id=$2",
          [id, input.data.recordId],
        )
      ).rows[0];
    const item = suite?.payload.cases.find((c) => c.id === input.data.caseId);
    if (
      !suite ||
      !item ||
      !run ||
      run.payload.repository !== suite.payload.repository ||
      run.payload.revision !== suite.payload.revision ||
      !run.payload.completedAt ||
      !run.payload.checks.some(
        (c: any) => c.id === item.checkId && c.method === "automated",
      )
    )
      throw new JobError(
        409,
        "The report must execute this case’s automated check on the registered source revision.",
      );
    if (
      suite.kind === "production" &&
      (!suite.reviewer_id ||
        Date.parse(run.created_at) <
          Date.parse(suite.reviewed_at || suite.created_at))
    )
      throw new JobError(
        409,
        "Production labels must be independently reviewed before a new assessment is received.",
      );
    if (
      suite.kind === "production" &&
      !(
        await c.query(
          "SELECT id FROM qa_jobs WHERE project_id=$1 AND record_id=$2 AND status='completed' AND created_at>=$3",
          [id, input.data.recordId, suite.reviewed_at],
        )
      ).rows.length
    )
      throw new JobError(
        409,
        "Production observations require a completed QA job requested after label review.",
      );
    const old = (
      await c.query<{ record_id: string }>(
        "SELECT record_id FROM qa_pilot_observations WHERE suite_id=$1 AND case_id=$2",
        [suiteId, item.id],
      )
    ).rows[0];
    if (old && old.record_id !== input.data.recordId)
      throw new JobError(
        409,
        "Pilot observations are immutable; register a new repeat case.",
      );
    const receipt = await archiveAssessment(
      r,
      c.query.bind(c),
      id,
      run.payload,
    );
    if (!receipt)
      throw new JobError(
        409,
        "A valid completed assessment snapshot is required.",
      );
    const status = run.payload.checks.find(
      (c: any) => c.id === item.checkId,
    ).status;
    await c.query(
      "INSERT INTO qa_pilot_observations(suite_id,case_id,record_id,report_digest,actual_status) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [suiteId, item.id, input.data.recordId, run.report_digest, status],
    );
    await c.query("COMMIT");
    return { linked: true };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
function measure(cases: { expected: string; actual: string }[]) {
  const defects = cases.filter((c) => c.expected === "defect"),
    clean = cases.filter((c) => c.expected === "clean"),
    executed = cases.filter(
      (c) =>
        ["passed", "failed"].includes(c.actual) ||
        (c.expected === "identity-block" && c.actual === "blocked"),
    );
  const tp = defects.filter((c) => c.actual === "failed").length,
    fp = clean.filter((c) => c.actual === "failed").length,
    tn = clean.filter((c) => c.actual === "passed").length;
  return {
    cases: cases.length,
    defectCases: defects.length,
    cleanCases: clean.length,
    detected: tp,
    missed: defects.filter((c) => c.actual === "passed").length,
    unverifiedDefects: defects.filter(
      (c) => !["passed", "failed"].includes(c.actual),
    ).length,
    falseAlarms: fp,
    recall: defects.length ? tp / defects.length : null,
    falseAlarmRate: fp + tn ? fp / (fp + tn) : null,
    reliability: cases.length ? executed.length / cases.length : null,
    missing: cases.filter((c) => c.actual === "missing").length,
  };
}
export async function assuranceState(r: Runtime, id: string) {
  const q = r.database.query.bind(r.database),
    suites = (
      await q<{
        id: string;
        name: string;
        kind: string;
        payload: z.infer<typeof Suite>;
        reviewer_id: string | null;
      }>(
        "SELECT * FROM qa_pilot_suites WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",
        [id],
      )
    ).rows,
    observations = (
      await q<{
        suite_id: string;
        case_id: string;
        record_id: string;
        report_digest: string;
        actual_status: string;
        current_digest: string | null;
        retained_record: string | null;
        payload: any;
        usage: any;
      }>(
        "SELECT o.*,r.record_id AS retained_record,encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') AS current_digest,jsonb_build_object('ai',r.payload->'ai') AS payload,u.payload AS usage FROM qa_pilot_observations o JOIN qa_pilot_suites s ON s.id=o.suite_id LEFT JOIN qa_runs r ON r.project_id=s.project_id AND r.record_id=o.record_id LEFT JOIN qa_usage u ON u.project_id=s.project_id AND u.record_id=o.record_id WHERE s.project_id=$1 AND s.id=ANY($2::text[])",
        [id, suites.map((s) => s.id)],
      )
    ).rows;
  const lookup = new Map(
    observations.map((o) => [o.suite_id + "/" + o.case_id, o]),
  );
  const details = suites.map((s) => ({
    ...s,
    cases: s.payload.cases.map((c) => {
      const o = lookup.get(s.id + "/" + c.id);
      return {
        ...c,
        recordId: o?.record_id || null,
        observedStatus: o?.actual_status || null,
        actual: !o?.retained_record
          ? "missing"
          : o.current_digest !== o.report_digest
            ? "stale"
            : o.actual_status,
      };
    }),
  }));
  const eligible = details.filter(
      (s) => s.kind === "production" && s.reviewer_id,
    ),
    measurements = measure(eligible.flatMap((s) => s.cases)),
    heldOut=measure(eligible.filter(s=>s.payload.partition==='held-out').flatMap(s=>s.cases)),
    defectGroups=new Map<string,string[]>(),
    recordIds = new Set(
      eligible.flatMap((s) => s.cases.map((c) => c.recordId).filter(Boolean)),
    ),
    records = [
      ...new Map(
        observations
          .filter((o) => recordIds.has(o.record_id))
          .map((o) => [o.record_id, o]),
      ).values(),
    ];
  for(const c of eligible.flatMap(s=>s.cases).filter(c=>c.expected==='defect'&&c.defectId)){defectGroups.set(c.defectId!,[...(defectGroups.get(c.defectId!)||[]),c.actual]);}
  const uniqueDefects={labeledIds:defectGroups.size,detected:[...defectGroups.values()].filter(v=>v.includes('failed')).length,executionsWithoutDefectId:eligible.flatMap(s=>s.cases).filter(c=>c.expected==='defect'&&!c.defectId).length};
  const costs = {
    assessments: records.length,
    estimatedInference: records.filter(
      (o) => o.payload?.ai?.costIsEstimate || o.usage?.costIsEstimate,
    ).length,
    knownInferenceUsd: records.reduce(
      (n, o) => n + (o.usage?.inferenceUsd ?? o.payload?.ai?.costUsd ?? 0),
      0,
    ),
    unknownInference: records.filter(
      (o) => o.usage?.inferenceUsd == null && o.payload?.ai?.costUsd == null,
    ).length,
    unknownInfrastructure: records.filter(
      (o) => o.usage?.infrastructureUsd == null,
    ).length,
    knownInfrastructureUsd: records.reduce(
      (n, o) => n + (o.usage?.infrastructureUsd ?? 0),
      0,
    ),
  };
  const evidence = (
      await q(
        "SELECT id,kind,payload,author_id,reviewer_id,created_at FROM qa_assurance_evidence WHERE project_id=$1 ORDER BY created_at DESC",
        [id],
      )
    ).rows,
    stored = (
      await q<{ payload: any; version: number }>(
        "SELECT payload,version FROM qa_assurance_policy WHERE project_id=$1",
        [id],
      )
    ).rows[0],
    policy = {
      ...defaults,
      ...stored?.payload,
      expectedVersion: stored?.version || 0,
    };
  const reasons: string[] = [];
  if(policy.requireHeldOut&&(heldOut.cases<10||!heldOut.defectCases||!heldOut.cleanCases||heldOut.recall===null||heldOut.recall<policy.minRecall||heldOut.falseAlarmRate===null||heldOut.falseAlarmRate>policy.maxFalseAlarmRate||heldOut.reliability===null||heldOut.reliability<policy.minReliability))reasons.push("Reviewed held-out evidence does not meet the selected thresholds (at least ten cases, defects and clean controls).");
  if (
    measurements.cases < policy.minCases ||
    records.length < policy.minAssessments
  )
    reasons.push(
      "More independently reviewed production cases and distinct assessments are required.",
    );
  if (!measurements.defectCases || !measurements.cleanCases)
    reasons.push("Include known defects and clean negative controls.");
  if (measurements.recall === null || measurements.recall < policy.minRecall)
    reasons.push("Defect recall is below policy or unknown.");
  if (
    measurements.falseAlarmRate === null ||
    measurements.falseAlarmRate > policy.maxFalseAlarmRate
  )
    reasons.push("False-alarm rate exceeds policy or is unknown.");
  if (
    measurements.reliability === null ||
    measurements.reliability < policy.minReliability
  )
    reasons.push("Execution reliability is below policy or unknown.");
  if (costs.knownInferenceUsd > policy.maxKnownInferenceUsd)
    reasons.push("Measured inference cost exceeds policy.");
  if (
    policy.requireKnownCosts &&
    (costs.unknownInference ||
      costs.unknownInfrastructure ||
      costs.estimatedInference)
  )
    reasons.push("Infrastructure or inference costs remain unknown.");
  for (const kind of policy.requiredEvidence)
    if (
      !evidence.some(
        (e: any) =>
          e.kind === kind &&
          e.reviewer_id &&
          Date.parse(e.created_at as string) > Date.now() - 30 * 86400000,
      )
    )
      reasons.push(
        "Current independently reviewed " + kind + " evidence is required.",
      );
  return {
    policy,
    suites: details
      .slice(0, 10)
      .map((s) => ({ ...s, metrics: measure(s.cases) })),
    productionMetrics: measurements,
    heldOutMetrics:heldOut,
    uniqueDefects,
    costs,
    evidence,
    eligible: reasons.length === 0,
    reasons,
    limits: [
      "Controlled/imported benchmarks cannot qualify a production release gate.",
      "Label review is a company review, not proof of an independent external security assessment.",
      "Expired/missing reports count as missing coverage. Report retention can invalidate eligibility.",
      "Metrics cover at most 100 suites; the ten latest are displayed. Whole-product defect recall and staffing savings are not inferred.",
    ],
  };
}
export async function saveAssurancePolicy(
  r: Runtime,
  id: string,
  body: unknown,
  actor: string,
) {
  const input = AssurancePolicy.safeParse(body);
  if (!input.success)
    throw new JobError(
      400,
      "Use bounded rollout thresholds and the current policy version.",
    );
  const state = await assuranceState(r, id);
  if (input.data.mode === "enforced") {
    const original = state.policy;
    const prospective = { ...input.data }; // Evaluate proposed thresholds without temporarily weakening persisted policy.
    const m = state.productionMetrics,
      c = state.costs,
      reasons = [
        ...(m.cases < prospective.minCases ||
        c.assessments < prospective.minAssessments
          ? ["Insufficient reviewed production assessments."]
          : []),
        ...(!m.defectCases ||
        !m.cleanCases ||
        m.recall === null ||
        m.recall < prospective.minRecall ||
        m.falseAlarmRate === null ||
        m.falseAlarmRate > prospective.maxFalseAlarmRate ||
        m.reliability === null ||
        m.reliability < prospective.minReliability
          ? ["Production measurements do not meet the proposed policy."]
          : []),
        ...(c.knownInferenceUsd > prospective.maxKnownInferenceUsd ||
        (prospective.requireKnownCosts &&
          (c.unknownInference ||
            c.unknownInfrastructure ||
            c.estimatedInference))
          ? ["Costs do not meet policy or remain unknown."]
          : []),
      ];
    if(prospective.requireHeldOut&&(state.heldOutMetrics.cases<10||!state.heldOutMetrics.defectCases||!state.heldOutMetrics.cleanCases||state.heldOutMetrics.recall===null||state.heldOutMetrics.recall<prospective.minRecall||state.heldOutMetrics.falseAlarmRate===null||state.heldOutMetrics.falseAlarmRate>prospective.maxFalseAlarmRate||state.heldOutMetrics.reliability===null||state.heldOutMetrics.reliability<prospective.minReliability))reasons.push("Qualified held-out pilot evidence is missing.");
    void original;
    for (const kind of prospective.requiredEvidence)
      if (
        !state.evidence.some(
          (e: any) =>
            e.kind === kind &&
            e.reviewer_id &&
            Date.parse(e.created_at as string) > Date.now() - 30 * 86400000,
        )
      )
        reasons.push("Reviewed " + kind + " evidence is missing.");
    if (reasons.length) throw new JobError(409, reasons.join(" "));
  }
  const c = await r.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [id]);
    const { expectedVersion, ...policy } = input.data;
    const prior = (
      await c.query<{ version: number }>(
        "SELECT version FROM qa_assurance_policy WHERE project_id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if ((prior?.version || 0) !== expectedVersion)
      throw new JobError(409, "Rollout policy changed. Reload first.");
    await c.query(
      "INSERT INTO qa_assurance_policy(project_id,version,payload) VALUES($1,1,$2::jsonb) ON CONFLICT(project_id) DO UPDATE SET version=qa_assurance_policy.version+1,payload=EXCLUDED.payload",
      [id, JSON.stringify(policy)],
    );
    await appendLedger(
      r,
      c.query.bind(c),
      id,
      "rollout-policy",
      "rollout-policy:" + ((prior?.version || 0) + 1),
      policy,
      actor,
    );
    await c.query("COMMIT");
    return { saved: true };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function assuranceEvidence(
  r: Runtime,
  id: string,
  body: unknown,
  actor: string,
) {
  const input = z
    .object({
      kind: z.enum(["sso", "offboarding", "devices", "security-review"]),
      title: z.string().min(1).max(160),
      issuer: z.string().min(1).max(160),
      artifactSha256: sha,
      reference: z.string().min(1).max(500),
      conclusion: z.string().min(1).max(2000),
    })
    .strict()
    .safeParse(body);
  if (!input.success)
    throw new JobError(
      400,
      "Supply the assessor/provider, report digest, reference and conclusion.",
    );
  const evidenceId = randomUUID();
  await r.database.query(
    "INSERT INTO qa_assurance_evidence(id,project_id,kind,payload,author_id) VALUES($1,$2,$3,$4::jsonb,$5)",
    [
      evidenceId,
      id,
      input.data.kind,
      JSON.stringify({
        ...input.data,
        source: "supplied-document; independently verify issuer and artifact",
      }),
      actor,
    ],
  );
  return { id: evidenceId };
}
export async function reviewAssuranceEvidence(
  r: Runtime,
  id: string,
  evidenceId: string,
  actor: string,
) {
  const c = await r.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [id]);
    const row = (
      await c.query<{ author_id: string; payload: unknown }>(
        "SELECT * FROM qa_assurance_evidence WHERE project_id=$1 AND id=$2 FOR UPDATE",
        [id, evidenceId],
      )
    ).rows[0];
    if (!row) throw new JobError(404, "Evidence unavailable.");
    if (row.author_id === actor)
      throw new JobError(
        403,
        "A different owner/admin must review the source document and issuer.",
      );
    await c.query(
      "UPDATE qa_assurance_evidence SET reviewer_id=$3 WHERE project_id=$1 AND id=$2",
      [id, evidenceId, actor],
    );
    await appendLedger(
      r,
      c.query.bind(c),
      id,
      "assurance-review",
      "assurance-review:" + evidenceId,
      { id: evidenceId, document: row.payload, reviewer: actor },
      actor,
    );
    await c.query("COMMIT");
    return { reviewed: true };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function rolloutDecision(
  r: Runtime,
  id: string,
  recordId: string | null,
) {
  const state = await assuranceState(r, id),
    reasons =
      state.policy.mode === "enforced"
        ? [...state.reasons]
        : ["Advisory mode does not authorize a production deployment."];
  if (recordId && state.policy.mode === "enforced") {
    const p = (
      await r.database.query<{ payload: any }>(
        "SELECT payload FROM qa_build_provenance WHERE project_id=$1 AND record_id=$2",
        [id, recordId],
      )
    ).rows[0];
    const report = (
      await r.database.query<{ payload: any }>(
        "SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2",
        [id, recordId],
      )
    ).rows[0];
    if (
      !report ||
      (report.payload.target &&
        (!p || p.payload.reportDigest !== hash(canonical(report.payload))))
    )
      reasons.push(
        "Verified GitHub build provenance is required for this exact retained assessment.",
      );
  }
  if (state.policy.mode === "enforced") {
    const row = recordId ? (await r.database.query<{payload:any}>("SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2",[id,recordId])).rows[0] : null;
    const frozen=recordId?(await r.database.query<{payload:any;execution_mode:string;hosted_visual_digest:string|null}>("SELECT payload,execution_mode,hosted_visual_digest FROM qa_jobs WHERE project_id=$1 AND record_id=$2 AND status='completed' ORDER BY created_at DESC LIMIT 1",[id,recordId])).rows[0]:null;
    if(!frozen)reasons.push("A completed server-enrolled QA job is required to authorize this assessment.");
    else if(row){
      reasons.push(...executionEvidenceReasons(frozen.payload,row.payload));
      const q=r.database.query.bind(r.database),current=(await q<{testing_profile:any;settings:any}>('SELECT testing_profile,settings FROM projects WHERE id=$1',[id])).rows[0];
      if(canonical(frozen.payload.testingProfile)!==canonical(TestingProfileSchema.parse(current.testing_profile||testingDefaults))||canonical(frozen.payload.settings)!==canonical(current.settings)||canonical(frozen.payload.unitTests||[])!==canonical(await enabledUnitTests(q,id)))reasons.push('Current test/model configuration differs from this frozen assessment.');
      const plan=await planSnapshot(q,id);if(frozen.payload.qualityPlan?frozen.payload.qualityPlan.digest!==plan.digest:plan.requirements.length||plan.brief)reasons.push('Current approved product context differs from this frozen assessment.');
      if(frozen.execution_mode==='hosted'&&frozen.payload.testingProfile?.visualRegression&&frozen.hosted_visual_digest!==await currentVisualDigest(q,id))reasons.push('Approved visual baselines differ from this hosted assessment.');
    }
    const completed = Date.parse(row?.payload.completedAt || "");
    if (!row || row.payload.phase !== "completed" || !Number.isFinite(completed) || completed > Date.now()+10000 || Date.now()-completed>3600000)
      reasons.push("This exact assessment must be complete and less than one hour old.");
    if (row && state.policy.requireArchiveAcknowledgment) {
      const digest = assessmentDigest(row.payload);
      const ack = await r.database.query("SELECT e.id FROM qa_assessment_ledger e JOIN qa_ledger_delivery d ON d.entry_id=e.id JOIN qa_ledger_connections c ON c.project_id=e.project_id WHERE e.project_id=$1 AND e.record_id=$2 AND e.event_type='assessment' AND e.payload_digest=$3 AND d.status='confirmed' AND d.destination_origin=c.origin AND d.destination_project=c.remote_project AND d.receipt->>'projectId'=c.remote_project AND d.receipt->>'payloadDigest'=e.payload_digest AND d.receipt->>'recordId'=e.record_id AND d.receipt->>'archived'='true'",[id,recordId,digest]);
      if (!ack.rows.length) reasons.push("The configured Java archive has not acknowledged this exact assessment version.");
    }
    if (row && state.policy.requireRetainedEvidence) {
      const checks = row.payload.checks.filter((c:any)=>c.required && c.method==='automated' && c.status==='passed');
      const retained = await retainedEvidenceChecks(r,id,recordId!,row.payload);
      if (!checks.length || checks.some((c:any)=>!retained.has(c.id))) reasons.push("Retained evidence is missing for one or more required passing checks.");
    }
  }
  return {
    mode: state.policy.mode,
    eligible: state.eligible,
    releaseAuthorized: state.policy.mode === "enforced" && reasons.length === 0,
    reasons,
    policyVersion: state.policy.expectedVersion,
  };
}
