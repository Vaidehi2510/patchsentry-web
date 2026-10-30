import { Resolver } from "node:dns/promises";
const resolver = new Resolver({ timeout: 3000, tries: 1 });
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Runtime } from "./runtime";
import { JobError } from "./jobs";
import { audit } from "./team";
import { matchesDomain, restrictedDomain } from "./domain-policy";
import { rate } from "./session-security";
export async function domainState(runtime: Runtime, projectId: string) {
  const row = (
    await runtime.database.query<{
      restricted: boolean;
      domain: string;
      challenge: string;
      verified_at: string | null;
      created_at: string;
    }>(
      "SELECT domain,challenge,verified_at,created_at,restricted FROM qa_work_domains WHERE project_id=$1",
      [projectId],
    )
  ).rows[0];
  return {
    domain: row
      ? {
          name: row.domain,
          restricted: row.restricted,
          recordName: "_patchsentry." + row.domain,
          recordValue: "patchsentry-verification=" + row.challenge,
          verifiedAt: row.verified_at,
          expiresAt: new Date(
            new Date(row.created_at).getTime() + 86400000,
          ).toISOString(),
        }
      : null,
  };
}
export async function configureDomain(
  runtime: Runtime,
  projectId: string,
  body: unknown,
) {
  const r = z
    .object({
      domain: z
        .string()
        .trim()
        .toLowerCase()
        .max(253)
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
    })
    .strict()
    .safeParse(body);
  if (!r.success)
    throw new JobError(
      400,
      "Enter a domain you administer, without a protocol or path.",
    );
  await rate(runtime, "domain:" + projectId, 5);
  if (await restrictedDomain(runtime.database.query.bind(runtime.database), projectId))
    throw new JobError(409, "Turn off domain restrictions before replacing the verified domain.");
  const saved = await runtime.database.query(
    "INSERT INTO qa_work_domains (project_id,domain,challenge) VALUES ($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET domain=EXCLUDED.domain,challenge=EXCLUDED.challenge,verified_at=NULL,created_at=now() WHERE qa_work_domains.restricted=false RETURNING project_id",
    [projectId, r.data.domain, randomBytes(24).toString("base64url")],
  );
  if(!saved.rows.length)throw new JobError(409,"Turn off domain restrictions before replacing this domain.");
  return domainReadiness(runtime, projectId);
}
export async function verifyDomain(runtime: Runtime, projectId: string) {
  await rate(runtime, "domain-verify:" + projectId, 5);
  const { domain } = await domainState(runtime, projectId);
  if (!domain || Date.parse(domain.expiresAt) < Date.now())
    throw new JobError(
      409,
      "Create a new domain challenge; it expires after 24 hours.",
    );
  let records: string[][];
  try {
    records = await (
      runtime.domainResolve || ((name) => resolver.resolveTxt(name))
    )(domain.recordName);
  } catch {
    throw new JobError(
      409,
      "The DNS TXT record is not visible yet. Check the exact name/value and retry after propagation.",
    );
  }
  if (!records.some((parts) => parts.join("") === domain.recordValue))
    throw new JobError(
      409,
      "DNS did not contain the required TXT value. Check the record and retry.",
    );
  const updated = await runtime.database.query(
    "UPDATE qa_work_domains SET verified_at=now() WHERE project_id=$1 AND domain=$2 AND challenge=$3 RETURNING project_id",
    [
      projectId,
      domain.name,
      domain.recordValue.slice("patchsentry-verification=".length),
    ],
  );
  if (!updated.rows.length)
    throw new JobError(
      409,
      "The domain challenge changed. Reload before verifying.",
    );
  return domainReadiness(runtime, projectId);
}

export async function domainReadiness(runtime: Runtime, projectId: string) {
  const state = await domainState(runtime, projectId);
  const people = (await runtime.database.query<{id:string;email:string;emailVerified:boolean}>(
    `SELECT u.id,u.email,u."emailVerified" FROM "user" u WHERE u.id IN (SELECT owner_id FROM projects WHERE id=$1 UNION SELECT user_id FROM qa_members WHERE project_id=$1)`, [projectId],
  )).rows;
  return {...state, incompatibleMembers: state.domain ? people.filter(u => !u.emailVerified || !matchesDomain(u.email,state.domain!.name)).map(u => ({id:u.id,email:u.email})) : []};
}

/** Owner-only API calls this under fresh MFA. Lock the same row as invitations. */
export async function setDomainRestriction(runtime:Runtime,projectId:string,body:unknown,actor:string) {
  const input=z.object({restricted:z.boolean()}).strict().safeParse(body);
  if(!input.success)throw new JobError(400,'Choose whether to restrict this project to its verified domain.');
  const c=await runtime.database.connect();
  try {
    await c.query('BEGIN');await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[projectId]);
    const domain=(await c.query<{domain:string;verified_at:string|null}>('SELECT domain,verified_at FROM qa_work_domains WHERE project_id=$1 FOR UPDATE',[projectId])).rows[0];
    if(!domain || input.data.restricted&&!domain.verified_at)throw new JobError(409,'Verify DNS ownership before enabling domain restrictions.');
    if(input.data.restricted){
      const users=(await c.query<{email:string;emailVerified:boolean}>(`SELECT u.email,u."emailVerified" FROM "user" u WHERE u.id IN (SELECT owner_id FROM projects WHERE id=$1 UNION SELECT user_id FROM qa_members WHERE project_id=$1) FOR UPDATE`,[projectId])).rows;
      if(users.some(u=>!u.emailVerified||!matchesDomain(u.email,domain.domain)))throw new JobError(409,'Every current member, including the owner, must have a verified email at @'+domain.domain+'. Remove outside members or update their verified addresses first.');
      await c.query("DELETE FROM qa_invites WHERE project_id=$1 AND split_part(lower(email),'@',2)<>$2",[projectId,domain.domain]);
      await c.query("UPDATE qa_automation_settings SET payload=jsonb_set(jsonb_set(payload,'{weeklyEmail}','false'::jsonb),'{weeklySlack}','false'::jsonb),updated_at=now() WHERE project_id=$1",[projectId]);
      // Queued report messages must not survive enabling the boundary.
      await c.query("UPDATE qa_notifications SET status='uncertain',claim_hash=NULL WHERE project_id=$1 AND status IN ('pending','sending')",[projectId]);
      await c.query("UPDATE projects SET slack_settings=jsonb_set(slack_settings,'{enabled}','false'::jsonb) WHERE id=$1",[projectId]);
    }
    await c.query('UPDATE qa_work_domains SET restricted=$2 WHERE project_id=$1',[projectId,input.data.restricted]);
    await audit(c.query.bind(c),projectId,actor,'domain.restriction_changed',input.data.restricted?'Restricted to @'+domain.domain+'; outbound reports disabled.':'Domain restriction disabled; invitation-only membership remains.');
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  return domainReadiness(runtime,projectId);
}
