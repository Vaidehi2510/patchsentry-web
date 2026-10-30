import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Runtime } from "./runtime";
import { appendLedger, ledgerPayload } from "./assessment-ledger";
import { JobError } from "./jobs";
const Minutes = z
  .object({
    setup: z.number().min(0).max(100000),
    maintenance: z.number().min(0).max(100000),
    triage: z.number().min(0).max(100000),
    approvals: z.number().min(0).max(100000),
    execution: z.number().min(0).max(100000),
  })
  .strict();
const Input = z
  .object({
    workflow: z.enum(["manual", "patchsentry"]),
    basis: z.enum(["measured", "estimated"]),
    minutes: Minutes,
    sampleId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    note: z.string().trim().min(1).max(1000),
  })
  .strict();
export async function recordPilotWork(
  r: Runtime,
  id: string,
  suiteId: string,
  body: unknown,
  actor: string,
) {
  const parsed = Input.safeParse(body);
  if (!parsed.success)
    throw new JobError(
      400,
      "Record setup, maintenance, triage, approval and execution minutes, measurement basis and a shared comparison sample ID.",
    );
  const c = await r.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [id]);
    const suite = (
      await c.query<{ payload: any }>(
        "SELECT payload FROM qa_pilot_suites WHERE project_id=$1 AND id=$2",
        [id, suiteId],
      )
    ).rows[0];
    if (!suite) throw new JobError(404, "Pilot unavailable.");
    const entry = await appendLedger(
      r,
      c.query.bind(c),
      id,
      "pilot-work",
      "pilot-work:" + randomUUID(),
      {
        suiteId,
        repository: suite.payload.repository,
        revision: suite.payload.revision,
        caseIds: suite.payload.cases.map((c: any) => c.id),
        ...parsed.data,
        source: "Company-supplied time log; not independently observed.",
      },
      actor,
    );
    await c.query("COMMIT");
    return { id: entry.id };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function pilotWorkState(r: Runtime, id: string) {
  const receipts = (
    await r.database.query<{ id: string; created_at: string }>(
      "SELECT id,created_at FROM qa_assessment_ledger WHERE project_id=$1 AND event_type='pilot-work' ORDER BY sequence DESC LIMIT 101",
      [id],
    )
  ).rows;
  const logs: any[] = [];
  let expired = 0;
  for (const receipt of receipts.slice(0, 100)) {
    try {
      logs.push({
        id: receipt.id,
        createdAt: receipt.created_at,
        ...(await ledgerPayload(r, id, receipt.id)),
      });
    } catch (e) {
      if (e instanceof JobError && e.status === 404) expired++;
      else throw e;
    }
  }
  const pairs = new Map<string, any>();
  for (const log of logs) {
    const key = log.suiteId + ":" + log.sampleId;
    const p = pairs.get(key) || {};
    if (!p[log.workflow]) p[log.workflow] = log;
    pairs.set(key, p);
  }
  const comparisons = [...pairs.values()]
    .filter((p) => p.manual && p.patchsentry)
    .map((p) => {
      const total = (v: any) =>
          Object.values(v.minutes).reduce<number>((a, n) => a + Number(n), 0),
        measured =
          p.manual.basis === "measured" && p.patchsentry.basis === "measured";
      return {
        suiteId: p.manual.suiteId,
        sampleId: p.manual.sampleId,
        basis: measured ? "self-reported measured" : "includes estimates",
        manualMinutes: total(p.manual),
        patchsentryMinutes: total(p.patchsentry),
        observedDifferenceMinutes: measured
          ? total(p.manual) - total(p.patchsentry)
          : null,
      };
    });
  return {
    logs: logs.slice(0, 20),
    comparisons,
    expired,
    truncated: receipts.length > 100,
    notice:
      "Compare the same registered workload and sample ID. Latest log per workflow is used; corrections remain in Ledger. Estimates are never measured savings. Company-entered time is not independent observation and does not establish headcount replacement or whole-product effectiveness.",
  };
}
