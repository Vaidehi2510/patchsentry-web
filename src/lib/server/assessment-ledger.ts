import { createHash, randomUUID } from "node:crypto";
import type { Database } from "./database";
import type { Runtime } from "./runtime";
import { canonical, policyDefaults } from "../quality";
import { RunInputSchema } from "../contracts";
import { encrypt, decrypt } from "./evidence";
import { JobError } from "./jobs";
const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
type Entry = {
  id: string;
  project_id: string;
  sequence: string;
  event_key: string;
  event_type: string;
  record_id: string | null;
  payload_digest: string;
  previous_hash: string;
  entry_hash: string;
  actor_digest: string;
  created_at: string;
};
function header(row: Entry) {
  return {
    version: 1,
    projectId: row.project_id,
    sequence: Number(row.sequence),
    eventKey: row.event_key,
    eventType: row.event_type,
    recordId: row.record_id,
    payloadDigest: row.payload_digest,
    previousHash: row.previous_hash,
    actorDigest: row.actor_digest,
    createdAt: row.created_at,
  };
}
export async function appendLedger(
  r: Runtime,
  q: Database["query"],
  projectId: string,
  eventType: string,
  eventKey: string,
  payload: unknown,
  actor: string,
  recordId: string | null = null,
) {
  await q("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [projectId]);
  const text = canonical(payload),
    digest = hash(text),
    prior = (
      await q<Entry>(
        "SELECT * FROM qa_assessment_ledger WHERE project_id=$1 AND event_key=$2",
        [projectId, eventKey],
      )
    ).rows[0];
  if (prior) {
    if (prior.payload_digest !== digest)
      throw new JobError(
        409,
        "This ledger event already identifies different data.",
      );
    return prior;
  }
  const last = (
    await q<Entry>(
      "SELECT * FROM qa_assessment_ledger WHERE project_id=$1 ORDER BY sequence DESC LIMIT 1",
      [projectId],
    )
  ).rows[0];
  const row: Entry = {
    id: randomUUID(),
    project_id: projectId,
    sequence: String(Number(last?.sequence || 0) + 1),
    event_key: eventKey,
    event_type: eventType,
    record_id: recordId,
    payload_digest: digest,
    previous_hash: last?.entry_hash || "0".repeat(64),
    entry_hash: "",
    actor_digest: hash(projectId + ":" + actor),
    created_at: new Date().toISOString(),
  };
  row.entry_hash = hash(canonical(header(row)));
  await q(
    "INSERT INTO qa_assessment_ledger(id,project_id,sequence,event_key,event_type,record_id,payload_digest,previous_hash,entry_hash,actor_digest,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      row.id,
      projectId,
      row.sequence,
      eventKey,
      eventType,
      recordId,
      digest,
      row.previous_hash,
      row.entry_hash,
      row.actor_digest,
      row.created_at,
    ],
  );
  const policy =
    (
      await q<{ quality_policy: any }>(
        "SELECT quality_policy FROM projects WHERE id=$1",
        [projectId],
      )
    ).rows[0]?.quality_policy || policyDefaults;
  await q(
    "INSERT INTO qa_ledger_payloads(entry_id,encrypted,expires_at) VALUES($1,$2,now()+$3*interval '1 day')",
    [
      row.id,
      encrypt(r, projectId, row.id, Buffer.from(text)),
      policy.reportRetentionDays || 90,
    ],
  );
  if (eventType === "assessment")
    await q("INSERT INTO qa_ledger_delivery(entry_id) VALUES($1)", [row.id]);
  return row;
}
export async function archiveAssessment(
  r: Runtime,
  q: Database["query"],
  projectId: string,
  raw: unknown,
  actor = "QA worker",
) {
  const { score, receivedAt, ...body } = raw as Record<string, unknown>;
  void score;
  void receivedAt;
  const parsed = RunInputSchema.safeParse(body);
  if (
    !parsed.success ||
    !parsed.data.completedAt ||
    parsed.data.phase !== "completed"
  )
    return null;
  const report = parsed.data,
    digest = hash(canonical(report));
  return appendLedger(
    r,
    q,
    projectId,
    "assessment",
    "assessment:" + report.recordId + ":" + digest,
    report,
    actor,
    report.recordId,
  );
}
export async function archiveStored(
  r: Runtime,
  projectId: string,
  recordId: string,
) {
  const c = await r.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      projectId,
    ]);
    const row = (
      await c.query<{ payload: unknown }>(
        "SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2 FOR UPDATE",
        [projectId, recordId],
      )
    ).rows[0];
    const receipt = row
      ? await archiveAssessment(r, c.query.bind(c), projectId, row.payload)
      : null;
    await c.query("COMMIT");
    return receipt;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function ledgerState(r: Runtime, id: string, before?: number) {
  return {
    entries: (
      await r.database.query(
        "SELECT e.*,d.status AS archive_status,d.receipt,(p.expires_at>now()) AS payload_retained FROM qa_assessment_ledger e LEFT JOIN qa_ledger_delivery d ON d.entry_id=e.id LEFT JOIN qa_ledger_payloads p ON p.entry_id=e.id WHERE e.project_id=$1 AND ($2::bigint IS NULL OR e.sequence<$2) ORDER BY e.sequence DESC LIMIT 100",
        [id, before || null],
      )
    ).rows,
    connection:
      (
        await r.database.query(
          "SELECT origin,remote_project FROM qa_ledger_connections WHERE project_id=$1",
          [id],
        )
      ).rows[0] || null,
    notice:
      "Hash chains detect changes relative to retained receipts. They are not independent notarization or protection against a database administrator replacing the entire history. Encrypted payloads expire under report retention; digest receipts remain until project deletion.",
  };
}
export async function ledgerPayload(r: Runtime, id: string, entryId: string) {
  const row = (
    await r.database.query<{ payload_digest: string; encrypted: Uint8Array }>(
      "SELECT e.payload_digest,p.encrypted FROM qa_assessment_ledger e JOIN qa_ledger_payloads p ON p.entry_id=e.id WHERE e.project_id=$1 AND e.id=$2 AND p.expires_at>now()",
      [id, entryId],
    )
  ).rows[0];
  if (!row)
    throw new JobError(
      404,
      "The retained ledger payload is unavailable or expired.",
    );
  const bytes = decrypt(r, id, entryId, Buffer.from(row.encrypted));
  if (hash(bytes) !== row.payload_digest)
    throw new JobError(409, "Ledger payload integrity failed.");
  return JSON.parse(bytes.toString());
}
export async function verifyLedger(r: Runtime, id: string) {
  const rows = (
    await r.database.query<Entry>(
      "SELECT * FROM qa_assessment_ledger WHERE project_id=$1 ORDER BY sequence LIMIT 10001",
      [id],
    )
  ).rows;
  let previous = "0".repeat(64),
    sequence = 1;
  for (const row of rows.slice(0, 10000)) {
    if (
      Number(row.sequence) !== sequence ||
      row.previous_hash !== previous ||
      hash(canonical(header(row))) !== row.entry_hash
    )
      return { valid: false, firstInvalidSequence: sequence, complete: false };
    previous = row.entry_hash;
    sequence++;
  }
  return {
    valid: true,
    complete: rows.length <= 10000,
    verifiedEntries: sequence - 1,
    headHash: previous,
    notice:
      rows.length > 10000
        ? "Verification is bounded to the first 10,000 entries."
        : "Retain this head receipt separately to detect wholesale replacement.",
  };
}
