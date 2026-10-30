import { policyFor } from "./quality";
import { createHash, randomUUID } from "node:crypto";
import type { Runtime } from "./runtime";
import type { Database } from "./database";
import type { RunInput } from "../contracts";
import { canonical } from "../quality";
import { appendLedger } from "./assessment-ledger";
/** Deterministic triage only. No model output changes expectations, policy or
 * source. Infrastructure/identity controls remain blocked work, not product bugs. */
export async function triageAssessment(
  r: Runtime,
  q: Database["query"],
  projectId: string,
  report: RunInput,
  jobId: string,
  job: any,
) {
  if (!(await policyFor(q, projectId)).automaticTriage)
    return { created: 0, enabled: false };
  const previous = (
    await q<{ payload: RunInput }>(
      "SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id<>$2 AND payload->>'revision'=$3 ORDER BY created_at DESC LIMIT 100",
      [projectId, report.recordId, report.revision],
    )
  ).rows;
  let created = 0;
  for (const check of report.checks
    .filter(
      (c) =>
        c.method === "automated" &&
        c.status === "failed" &&
        !/^(release-|hosted-visual-baseline-stability)/.test(c.id),
    )
    .slice(0, 40)) {
    const linked = (job.qualityPlan?.requirements || []).filter(
      (v: any) =>
        v.checkIds.includes(check.id) ||
        v.goalIds.some((id: string) =>
          ["goal-" + id, "replay-" + id].includes(check.id),
        ),
    );
    const inconsistent = previous.some(
      (v) =>
        v.payload.qualityPlanDigest === report.qualityPlanDigest &&
        canonical(v.payload.target || v.payload.pr) ===
          canonical(report.target || report.pr) &&
        v.payload.checks.some(
          (c) =>
            c.id === check.id &&
            c.method === "automated" &&
            c.status === "passed",
        ),
    );
    const severity = linked.some((v: any) => v.risk === "critical")
      ? "critical"
      : linked.some((v: any) => v.risk === "high")
        ? "high"
        : "medium";
    const kind = inconsistent ? "flaky-test" : "product",
      fingerprint = createHash("sha256")
        .update(
          canonical([
            "automatic-triage",
            report.revision,
            report.target || report.pr,
            report.qualityPlanDigest || null,
            check.id.replace(/^replay-/, "goal-"),
            kind,
          ]),
        )
        .digest("hex");
    const payload = {
      kind,
      title:
        (inconsistent ? "Inconsistent check: " : "Failed check: ") +
        check.name.slice(0, 120),
      severity,
      category: linked[0]?.category || "workflow",
      recordId: report.recordId,
      checkId: check.id,
      expected:
        linked
          .map((v: any) => v.acceptance)
          .join("\n")
          .slice(0, 2000) ||
        "The approved automated check must meet its saved expected result.",
      actual: (
        check.details ||
        "The automated check failed. Inspect linked evidence before classifying root cause."
      ).slice(0, 2000),
      steps: [
        "Use the disposable environment configured in this frozen QA job.",
        "Test exact source revision " + report.revision + ".",
        "Run check " +
          check.id +
          " with the frozen job assertions and controlled test data.",
        "Compare actual outcome with the approved expectation; inspect available evidence.",
      ],
      suggestedFix:
        "Investigate the retained execution evidence and linked requirement. No code change or root-cause fix has been verified.",
      requirementIds: linked.map((v: any) => v.id),
      revision: report.revision,
      target: report.target || null,
      pr: report.pr || null,
      sourcePlanDigest: report.qualityPlanDigest || null,
      origin: "automatic deterministic triage",
      jobId,
      rootCause: "unverified",
      limitations: inconsistent
        ? [
            "Contradictory comparable executions are a flakiness signal, not proof of root cause. The failed result is preserved.",
          ]
        : [
            "Automated failure is a candidate defect. Human clarification is needed only where expected behavior or root cause is uncertain.",
          ],
    };
    const row = (
      await q<{ id: string }>(
        "INSERT INTO qa_bugs(id,project_id,payload,fingerprint) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(project_id,fingerprint) DO NOTHING RETURNING id",
        [randomUUID(), projectId, JSON.stringify(payload), fingerprint],
      )
    ).rows[0];
    if (row) {
      await appendLedger(
        r,
        q,
        projectId,
        "defect-reported",
        "defect:" + row.id,
        { bugId: row.id, ...payload },
        "Automatic triage",
        report.recordId,
      );
      created++;
    }
  }
  return { created };
}
