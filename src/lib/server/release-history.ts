import type { Runtime } from "./runtime";
import { ledgerPayload } from "./assessment-ledger";
import { JobError } from "./jobs";

/** Bounded, paginated history using the existing Ledger, never a parallel store.
 * Global definition/policy events precede a release and can affect its decision.
 * Downloadable evidence always remains behind current project authorization. */
export async function releaseHistory(
  r: Runtime,
  projectId: string,
  recordId: string,
  before?: number,
) {
  if (!/^[a-f0-9]{64}$/.test(recordId))
    throw new JobError(400, "Use the exact assessment record ID.");
  const q = r.database.query.bind(r.database),
    anchor = (
      await q<{ sequence: string }>(
        "SELECT max(sequence) AS sequence FROM qa_assessment_ledger WHERE project_id=$1 AND record_id=$2",
        [projectId, recordId],
      )
    ).rows[0];
  if (!anchor?.sequence)
    throw new JobError(
      404,
      "No retained Ledger history exists for this assessment. Backfill a retained report first.",
    );
  const rows = (
    await q<{
      id: string;
      sequence: string;
      event_type: string;
      record_id: string | null;
      payload_digest: string;
      entry_hash: string;
      created_at: string;
    }>(
      "SELECT id,sequence,event_type,record_id,payload_digest,entry_hash,created_at FROM qa_assessment_ledger WHERE project_id=$1 AND sequence<=$3 AND ($4::bigint IS NULL OR sequence<$4) AND (record_id=$2 OR record_id IS NULL) ORDER BY sequence DESC LIMIT 11",
      [projectId, recordId, Number(anchor.sequence), before || null],
    )
  ).rows;
  const events = [];
  let total = 0;
  for (const e of rows.slice(0, 10)) {
    let payload: unknown = null,
      availability = "retained";
    try {
      payload = await ledgerPayload(r, projectId, e.id);
    } catch (error) {
      if (error instanceof JobError && error.status === 404)
        availability = "expired";
      else throw error;
    }
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (total + bytes > 1500000) {
      payload = null;
      availability = "download-separately";
    } else total += bytes;
    events.push({
      ...e,
      payload,
      availability,
      payloadUrl: `/api/projects/${projectId}/ledger/${e.id}`,
    });
  }
  const evidence = (
    await q(
      "SELECT id,metadata,expires_at,(expires_at>now()) AS retained FROM qa_evidence WHERE project_id=$1 AND record_id=$2 ORDER BY created_at LIMIT 21",
      [projectId, recordId],
    )
  ).rows;
  return {
    schemaVersion: 1,
    projectId,
    recordId,
    asOfSequence:Number(anchor.sequence),
    payloadsComplete:events.every(e=>e.availability==='retained'),
    events,
    nextBefore: rows.length > 10 ? Number(rows[9].sequence) : null,
    evidence: evidence
      .slice(0, 20)
      .map((e) => ({
        ...e,
        downloadUrl: `/api/projects/${projectId}/evidence/${e.id}`,
      })),
    notice:
      "Follow nextBefore until null for the retained history. A missing payload is explicitly marked; digest receipts do not recreate expired evidence. Evidence bytes require separate authenticated downloads. Earlier project configuration events are included; exact frozen job inputs are in assessment-context. History and artifact downloads recheck current membership and SSO. Copies already downloaded cannot be revoked.",
  };
}
