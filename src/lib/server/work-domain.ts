import { Resolver } from "node:dns/promises";
const resolver = new Resolver({ timeout: 3000, tries: 1 });
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Runtime } from "./runtime";
import { JobError } from "./jobs";
import { rate } from "./session-security";
export async function domainState(runtime: Runtime, projectId: string) {
  const row = (
    await runtime.database.query<{
      domain: string;
      challenge: string;
      verified_at: string | null;
      created_at: string;
    }>(
      "SELECT domain,challenge,verified_at,created_at FROM qa_work_domains WHERE project_id=$1",
      [projectId],
    )
  ).rows[0];
  return {
    domain: row
      ? {
          name: row.domain,
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
  await runtime.database.query(
    "INSERT INTO qa_work_domains (project_id,domain,challenge) VALUES ($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET domain=EXCLUDED.domain,challenge=EXCLUDED.challenge,verified_at=NULL,created_at=now()",
    [projectId, r.data.domain, randomBytes(24).toString("base64url")],
  );
  return domainState(runtime, projectId);
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
  return domainState(runtime, projectId);
}
