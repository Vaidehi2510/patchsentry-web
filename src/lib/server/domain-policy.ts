import type { Database } from './database';
import { JobError } from './jobs';

/** Exact domain match: subdomains and lookalike suffixes are separate identities. */
export function matchesDomain(email: string, domain: string) {
  return email.trim().toLowerCase().split('@').length === 2 && email.trim().toLowerCase().split('@')[1] === domain;
}
export async function restrictedDomain(q: Database['query'], projectId: string) {
  return (await q<{domain: string; verified_at: string | null}>(
    'SELECT domain,verified_at FROM qa_work_domains WHERE project_id=$1 AND restricted=true', [projectId],
  )).rows[0] || null;
}
export async function domainAllowsUser(q: Database['query'], projectId: string, userId: string) {
  if((await q('SELECT d.id FROM qa_directory_users d JOIN "user" u ON lower(u.email)=d.email WHERE d.project_id=$1 AND u.id=$2 AND d.active=false',[projectId,userId])).rows.length)return false;
  const policy = await restrictedDomain(q, projectId);
  if (!policy) return true;
  const user = (await q<{email: string; emailVerified: boolean}>('SELECT email,"emailVerified" FROM "user" WHERE id=$1', [userId])).rows[0];
  return Boolean(policy.verified_at && user?.emailVerified && matchesDomain(user.email, policy.domain));
}
export async function requireDomainEmail(q: Database['query'], projectId: string, email: string) {
  const policy = await restrictedDomain(q, projectId);
  if (policy && (!policy.verified_at || !matchesDomain(email, policy.domain)))
    throw new JobError(403, 'This project accepts only verified accounts at @' + policy.domain + '.');
}
