import type { RunInput } from "./contracts";
import type { JobInput } from "./jobs";
import { jobReportMatches } from "./jobs";
/** Recompute the expected denominator from frozen server inputs. A worker cannot
 * omit a requested check, mark it optional or substitute an analysis finding. */
export function executionEvidenceReasons(job: JobInput, report: RunInput) {
  const reasons: string[] = [];
  if (!job || typeof job.repository !== "string" || !job.testingProfile)
    return ["Frozen job execution inputs are unavailable or unsupported."];
  if (
    !jobReportMatches(job, report) ||
    report.phase !== "completed" ||
    !report.completedAt
  )
    reasons.push(
      "The completed report must match the frozen job identity and approved plan.",
    );
  const completed = Date.parse(report.completedAt || "");
  if (
    !Number.isFinite(completed) ||
    completed > Date.now() + 10000 ||
    Date.now() - completed > 3600000
  )
    reasons.push(
      "Execution evidence must be complete and less than one hour old.",
    );
  if(job.settings?.roles.some(role=>role!=='planner')&&(!report.ai.calls||!report.checks.some(c=>['autonomy-specialists','ai-team-review'].includes(c.id)&&c.required&&c.method==='analysis'&&c.status==='passed')))reasons.push('Configured AI specialist review lacks completed inference/review evidence. Deterministic tests do not substitute for that requested review.');
  const required = new Set<string>();
  for (const goal of job.testingProfile?.goals.goals || [])
    for (const prefix of ["goal-", "replay-"]) required.add(prefix + goal.id);
  if (job.unitTests?.length)
    required.add("runner-patchsentry-authored-unit-tests");
  for (const requirement of job.qualityPlan?.requirements || [])
    if (["critical", "high"].includes(requirement.risk)) {
      for (const id of requirement.checkIds) required.add(id);
      for (const id of requirement.goalIds)
        for (const prefix of ["goal-", "replay-"]) required.add(prefix + id);
      if (!requirement.checkIds.length && !requirement.goalIds.length)
        reasons.push(
          "An approved critical/high requirement lacks an explicit test mapping: " +
            requirement.id,
        );
    }
  for (const id of required)
    if (
      !report.checks.some(
        (c) =>
          c.id === id &&
          c.required &&
          c.method === "automated" &&
          c.status === "passed",
      )
    )
      reasons.push("Missing passing required execution evidence: " + id);
  if (!required.size)
    reasons.push(
      "No configured automated product checks establish this assessment scope.",
    );
  return reasons;
}
