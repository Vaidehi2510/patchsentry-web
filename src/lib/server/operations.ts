import { randomUUID } from "node:crypto";
import type { Runtime } from "./runtime";
import { audit, queueNotification } from "./team";
import { appendLedger } from "./assessment-ledger";
// These are application-enforced pilot ceilings, not provider quota or an SLA.
export const hostedLimits = {
  monthlyAssessments: 8,
  globalActive: 2,
  maxMinutes: 15,
  maxVcpus: 2,
  queuePerProject: 20,
  retainedJobsPerProject: 1000,
};
export async function operationsState(r: Runtime, id: string) {
  const q = r.database.query.bind(r.database);
  const jobs = (
    await q(
      "SELECT status,count(*)::int AS count FROM qa_jobs WHERE project_id=$1 GROUP BY status",
      [id],
    )
  ).rows;
  const archives = (
    await q(
      "SELECT d.status,count(*)::int AS count FROM qa_ledger_delivery d JOIN qa_assessment_ledger e ON e.id=d.entry_id WHERE e.project_id=$1 GROUP BY d.status",
      [id],
    )
  ).rows;
  const usage = (
    await q(
      "SELECT count(*) FILTER(WHERE created_at>=date_trunc('month',now()) AND (status IN ('queued','running','completed') OR attempts>0))::int AS used,count(*) FILTER(WHERE status IN ('queued','running'))::int AS active FROM qa_jobs WHERE execution_mode='hosted'",
    )
  ).rows[0];
  const pending = (
    await q(
      "SELECT status,count(*)::int AS count FROM qa_automation_events WHERE project_id=$1 AND status IN ('received','waiting','processing','blocked') GROUP BY status",
      [id],
    )
  ).rows;
  return {
    jobs,
    archives,
    pendingEvents: pending,
    hosted: {
      limits: hostedLimits,
      sharedMonthlyUsed: usage.used,
      sharedActive: usage.active,
      providerQuotaVerified: false,
    },
    maintenanceConfigured: Boolean(r.config.cronSecret),
    notice:
      "These are enforced shared pilot limits. Provider credits, account quotas, uptime, recovery guarantees and costs require operator validation. Terminal infrastructure states are untested work, never passing coverage. No automatic paid execution retry occurs.",
  };
}
/** Expire work even when nobody opens the project. Freeze terminal infrastructure
 * outcomes in the existing Ledger. No paid retry or external notification send. */
export async function recoverExecutions(r: Runtime) {
  const candidates = (
    await r.database.query<{ id: string; project_id: string }>(
      "SELECT id,project_id FROM qa_jobs WHERE (status='running' AND lease_expires_at<=now()) OR (execution_mode='hosted' AND status='queued' AND created_at<now()-interval '5 minutes') ORDER BY updated_at LIMIT 100",
    )
  ).rows;
  let recovered = 0;
  for (const job of candidates) {
    const c = await r.database.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        job.project_id,
      ]);
      const row = (
        await c.query<{ payload: any; attempts: number }>(
          "UPDATE qa_jobs SET status='blocked',message='Execution expired or startup was interrupted. Product behavior is untested; inspect prior evidence before explicitly retrying.',lease_hash=NULL,callback_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND project_id=$2 AND ((status='running' AND lease_expires_at<=now()) OR (execution_mode='hosted' AND status='queued' AND created_at<now()-interval '5 minutes')) RETURNING payload,attempts",
          [job.id, job.project_id],
        )
      ).rows[0];
      if (row) {
        await appendLedger(
          r,
          c.query.bind(c),
          job.project_id,
          "execution-ended",
          "execution-expired:" + job.id + ":" + row.attempts,
          {
            jobId: job.id,
            repository: row.payload.repository,
            revision: row.payload.revision,
            subject: row.payload.target || row.payload.pr,
            status: "infrastructure-error",
            coverage: "not-tested",
            attempt: row.attempts,
          },
          "Recovery controller",
        );
        await audit(
          c.query.bind(c),
          job.project_id,
          "Recovery controller",
          "qa.execution_expired",
          job.id,
        );
        await queueNotification(
          c.query.bind(c),
          job.project_id,
          "blocked",
          job.id + ":expired:" + row.attempts,
          {
            jobId: job.id,
            repository: row.payload.repository,
            revision: row.payload.revision,
            message: "Execution expired; product behavior remains untested.",
          },
        );
        recovered++;
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  return { recovered };
}

export async function trackedOperation(
  r: Runtime,
  name: "maintenance" | "weekly",
  work: () => Promise<unknown>,
) {
  const runId = randomUUID(),
    q = r.database.query.bind(r.database);
  const claimed = (
    await q(
      "INSERT INTO qa_operation_health(name,run_id,state,last_started_at) VALUES($1,$2,'running',now()) ON CONFLICT(name) DO UPDATE SET run_id=EXCLUDED.run_id,state='running',last_started_at=now() WHERE qa_operation_health.state<>'running' OR qa_operation_health.last_started_at<now()-interval '10 minutes' RETURNING name",
      [name, runId],
    )
  ).rows.length;
  if (!claimed) return { running: true };
  try {
    const result = await work();
    await q(
      "UPDATE qa_operation_health SET state='succeeded',last_succeeded_at=now(),summary=$3::jsonb WHERE name=$1 AND run_id=$2",
      [name, runId, JSON.stringify(result ?? {})],
    );
    return result;
  } catch (error) {
    await q(
      "UPDATE qa_operation_health SET state='failed',last_failed_at=now(),summary='{\"message\":\"Scheduled operation failed; inspect authorized operator logs. No coverage inferred.\"}'::jsonb WHERE name=$1 AND run_id=$2",
      [name, runId],
    );
    throw error;
  }
}
export async function operationHealth(r: Runtime) {
  return {
    tasks: (
      await r.database.query(
        "SELECT name,state,last_started_at,last_succeeded_at,last_failed_at,(state='running' AND last_started_at<now()-interval '10 minutes') AS interrupted FROM qa_operation_health ORDER BY name",
      )
    ).rows,
    notice:
      "A configured scheduler is not proof of successful work. Alert on failed/interrupted operations and missing maintenance success for 26 hours or weekly success for eight days. No paging service or staffed SLA is implied.",
  };
}
