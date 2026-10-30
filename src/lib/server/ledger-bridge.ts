import {domainAllowsUser} from './domain-policy';
import { createDecipheriv, hkdfSync, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Runtime } from "./runtime";
import { sealProvider } from "./provider-vault";
import { ledgerPayload } from "./assessment-ledger";
import { canonical } from "../quality";
import { JobError } from "./jobs";
import { audit } from "./team";
function token(r: Runtime, id: string, raw: Uint8Array) {
  const b = Buffer.from(raw),
    key = Buffer.from(
      hkdfSync(
        "sha256",
        r.config.secret,
        id,
        "patchsentry-provider-vault-v1",
        32,
      ),
    ),
    d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAAD(Buffer.from(id + ":ledger"));
  d.setAuthTag(b.subarray(-16));
  return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
}
async function request(
  r: Runtime,
  origin: string,
  path: string,
  key: string,
  body?: unknown,
) {
  if (!r.config.ledgerAllowedOrigins?.includes(origin))
    throw new JobError(
      403,
      "This Ledger origin must be approved by the deployment operator first. The hosted website ledger works without a Java service.",
    );
  const response = await (r.ledgerFetch || fetch)(origin + path, {
    method: body === undefined ? "GET" : "PUT",
    headers: {
      authorization: "Bearer " + key,
      "content-type": "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    ...(body === undefined ? {} : { body: canonical(body) }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new JobError(
      response.status === 409 ? 409 : 502,
      "Ledger rejected the scoped archive request. Check service access, version and project token.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new JobError(502, "Ledger returned no receipt.");
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const p = await reader.read();
    if (p.done) break;
    size += p.value.length;
    if (size > 16000) {
      await reader.cancel();
      throw new JobError(502, "Ledger response exceeded its bound.");
    }
    chunks.push(Buffer.from(p.value));
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export async function connectLedger(
  r: Runtime,
  id: string,
  body: unknown,
  actor: string,
) {
  const input = z
    .object({
      origin: z.url().max(253),
      token: z.string().regex(/^psl_[A-Za-z0-9_-]{43}$/),
      approveAssessmentTransfer: z.literal(true),
    })
    .strict()
    .safeParse(body);
  if (!input.success)
    throw new JobError(
      400,
      "Use the approved Ledger HTTPS origin and a project-scoped psl_ runner token.",
    );
  const url = new URL(input.data.origin);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new JobError(
      400,
      "Use a plain HTTPS origin without credentials or paths.",
    );
  const repo = (
      await r.database.query<{ repository: string }>(
        "SELECT repository FROM projects WHERE id=$1",
        [id],
      )
    ).rows[0].repository,
    remote = await request(
      r,
      url.origin,
      "/api/runner/project",
      input.data.token,
    );
  if (
    !z.uuid().safeParse(remote.projectId).success ||
    remote.repository?.toLowerCase() !== repo.toLowerCase() ||
    !remote.capabilities?.includes("assessment-archive-v1")
  )
    throw new JobError(
      409,
      "The Ledger token must belong to this repository and support portal assessment archives.",
    );
  await r.database.query(
    "INSERT INTO qa_ledger_connections(project_id,origin,remote_project,encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET origin=EXCLUDED.origin,remote_project=EXCLUDED.remote_project,encrypted=EXCLUDED.encrypted",
    [
      id,
      url.origin,
      remote.projectId,
      sealProvider(r, id, input.data.token, "ledger"),
    ],
  );
  await r.database.query("UPDATE qa_ledger_delivery SET status='pending',attempts=0,receipt=NULL,claim_id=NULL WHERE entry_id IN(SELECT id FROM qa_assessment_ledger WHERE project_id=$1) AND status<>'expired' AND (destination_origin IS DISTINCT FROM $2 OR destination_project IS DISTINCT FROM $3)",[id,url.origin,remote.projectId]);
  await audit(
    r.database.query.bind(r.database),
    id,
    actor,
    "ledger.connected",
    "Explicit assessment transfer to an operator-approved, project-scoped Ledger.",
  );
  return { connected: true };
}
async function archivePrincipal(r:Runtime,id:string){const row=(await r.database.query<{owner_id:string}>('SELECT owner_id FROM projects WHERE id=$1',[id])).rows[0];if(!row||!await domainAllowsUser(r.database.query.bind(r.database),id,row.owner_id))throw new JobError(403,'Archive delivery is suspended while its owning project principal is offboarded.');}
export async function deliverLedger(r: Runtime, id: string) {
  await archivePrincipal(r,id);
  const c = r.database,
    q = c.query.bind(c),
    cfg = (
      await q<{
        origin: string;
        remote_project: string;
        encrypted: Uint8Array;
      }>("SELECT * FROM qa_ledger_connections WHERE project_id=$1", [id])
    ).rows[0];
  if (!cfg) return { delivered: 0 };
  let delivered = 0;
  await q(
    "UPDATE qa_ledger_delivery SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END WHERE status='sending' AND claimed_at<now()-interval '2 minutes' AND entry_id IN(SELECT id FROM qa_assessment_ledger WHERE project_id=$1)",
    [id],
  );
  for (let i = 0; i < 10; i++) {
    const claimId=randomUUID();
    const row = (
      await q<{
        entry_id: string;
        record_id: string;
        payload_digest: string;
        attempts: number;
      }>(
        "UPDATE qa_ledger_delivery d SET status='sending',attempts=attempts+1,claimed_at=now(),destination_origin=$2,destination_project=$3,claim_id=$4 WHERE entry_id=(SELECT d.entry_id FROM qa_ledger_delivery d JOIN qa_assessment_ledger e ON e.id=d.entry_id WHERE e.project_id=$1 AND d.status='pending' AND d.attempts<3 ORDER BY e.sequence LIMIT 1 FOR UPDATE OF d SKIP LOCKED) RETURNING d.entry_id,d.attempts,(SELECT record_id FROM qa_assessment_ledger WHERE id=d.entry_id) AS record_id,(SELECT payload_digest FROM qa_assessment_ledger WHERE id=d.entry_id) AS payload_digest",
        [id,cfg.origin,cfg.remote_project,claimId],
      )
    ).rows[0];
    if (!row) break;
    try {
      const payload = await ledgerPayload(r, id, row.entry_id),
        receipt = await request(
          r,
          cfg.origin,
          "/api/runner/assessments/" + row.record_id + "/" + row.payload_digest,
          token(r, id, cfg.encrypted),
          payload,
        );
      if (
        receipt.projectId !== cfg.remote_project ||
        receipt.recordId !== row.record_id ||
        receipt.payloadDigest !== row.payload_digest ||
        receipt.archived !== true
      )
        throw new JobError(409, "Ledger returned a mismatched receipt.");
      const acknowledged=await q(
        "UPDATE qa_ledger_delivery SET status='confirmed',verified_at=now(),receipt=$2::jsonb WHERE entry_id=$1 AND status='sending' AND destination_origin=$3 AND destination_project=$4 AND claim_id=$6 AND EXISTS(SELECT 1 FROM qa_ledger_connections c WHERE c.project_id=$5 AND c.origin=$3 AND c.remote_project=$4) RETURNING entry_id",
        [row.entry_id, JSON.stringify(receipt),cfg.origin,cfg.remote_project,id,claimId],
      );
      if(acknowledged.rows.length)delivered++;
    } catch (e) {
      const status =
        e instanceof JobError && e.status === 404
          ? "expired"
          : e instanceof JobError && e.status === 409
            ? "conflict"
            : row.attempts >= 3
              ? "failed"
              : "pending";
      await q("UPDATE qa_ledger_delivery SET status=$2 WHERE entry_id=$1 AND claim_id=$3", [
        row.entry_id,
        status,
        claimId,
      ]);
      if (status !== "expired") break;
    }
  }
  await q("UPDATE qa_ledger_connections SET last_delivery_at=now() WHERE project_id=$1",[id]);
  return { delivered };
}
export async function scheduledLedger(r: Runtime) {
  const rows = (
    await r.database.query<{ project_id: string }>(
      "SELECT project_id FROM qa_ledger_connections ORDER BY last_delivery_at NULLS FIRST,project_id LIMIT 20",
    )
  ).rows;
  for (const row of rows) {try{await reconcileLedger(r,row.project_id);await deliverLedger(r,row.project_id);}catch{await audit(r.database.query.bind(r.database),row.project_id,'Archive controller','ledger.delivery_blocked','Archive delivery or owning principal unavailable; no archive acknowledgment inferred.');}finally{await r.database.query('UPDATE qa_ledger_connections SET last_delivery_at=now() WHERE project_id=$1',[row.project_id]);}}
}

export async function reconcileLedger(r:Runtime,id:string){
 await archivePrincipal(r,id);
 const q=r.database.query.bind(r.database),cfg=(await q<{origin:string;remote_project:string;encrypted:Uint8Array}>('SELECT * FROM qa_ledger_connections WHERE project_id=$1',[id])).rows[0];
 if(!cfg)return {checked:0};
 const rows=(await q<{entry_id:string;record_id:string;payload_digest:string}>("SELECT d.entry_id,e.record_id,e.payload_digest FROM qa_ledger_delivery d JOIN qa_assessment_ledger e ON e.id=d.entry_id WHERE e.project_id=$1 AND d.status='confirmed' ORDER BY d.verified_at NULLS FIRST,e.sequence LIMIT 10",[id])).rows;
 let checked=0;
 for(const row of rows){let status='confirmed';try{
 const receipt=await request(r,cfg.origin,'/api/runner/assessments/'+row.record_id+'/'+row.payload_digest,token(r,id,cfg.encrypted));
 if(receipt.projectId!==cfg.remote_project||receipt.recordId!==row.record_id||receipt.payloadDigest!==row.payload_digest||receipt.archived!==true)status='conflict';
 }catch{status='failed';}
 await q('UPDATE qa_ledger_delivery SET status=$2,verified_at=now() WHERE entry_id=$1 AND destination_origin=$3 AND destination_project=$4',[row.entry_id,status,cfg.origin,cfg.remote_project]);checked++;
 }
 return {checked};
}
