import { z } from "zod";
import { createHash } from "node:crypto";
import type { Runtime } from "./runtime";
import { canonical } from "../quality";
import { authority } from "./automation";
import { appendLedger } from "./assessment-ledger";
import { JobError } from "./jobs";
async function github(
  r: Runtime,
  repository: string,
  path: string,
  token: string,
) {
  const res = await (r.repositoryFetch || fetch)(
    "https://api.github.com/repos/" + repository + path,
    {
      headers: {
        authorization: "Bearer " + token,
        accept: "application/vnd.github+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) {
    await res.body?.cancel();
    throw new JobError(
      409,
      "GitHub Actions read access could not verify the build evidence.",
    );
  }
  const reader = res.body?.getReader();
  if (!reader) throw new JobError(409, "GitHub returned no build evidence.");
  const bytes: Buffer[] = [];
  let size = 0;
  for (;;) {
    const p = await reader.read();
    if (p.done) break;
    size += p.value.length;
    if (size > 1000000) {
      await reader.cancel();
      throw new JobError(413, "Build evidence exceeds the response bound.");
    }
    bytes.push(Buffer.from(p.value));
  }
  return JSON.parse(Buffer.concat(bytes).toString());
}
export async function verifyBuildProvenance(
  r: Runtime,
  id: string,
  body: unknown,
  actor: string,
) {
  const input = z
    .object({
      recordId: z.string().regex(/^[a-f0-9]{64}$/),
      runId: z.number().int().positive(),
      artifactId: z.number().int().positive(),
    })
    .strict()
    .safeParse(body);
  if (!input.success)
    throw new JobError(
      400,
      "Supply the exact assessment, GitHub Actions run ID and artifact ID.",
    );
  const project = (
      await r.database.query<any>("SELECT * FROM projects WHERE id=$1", [id])
    ).rows[0],
    record = (
      await r.database.query<{ payload: any }>(
        "SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2",
        [id, input.data.recordId],
      )
    ).rows[0]?.payload;
  if (
    !record?.target ||
    !(
      await r.database.query(
        "SELECT id FROM qa_jobs WHERE project_id=$1 AND record_id=$2 AND execution_mode='hosted' AND status='completed'",
        [id, input.data.recordId],
      )
    ).rows.length ||
    !["release-artifact", "release-artifact-stability"].every((cid) =>
      record.checks.some(
        (c: any) =>
          c.id === cid && c.method === "automated" && c.status === "passed",
      ),
    )
  )
    throw new JobError(
      409,
      "A completed hosted build/release assessment must establish the actual artifact bytes first.",
    );
  const { token, repo } = await authority(r, project),
    run = await github(
      r,
      project.repository,
      "/actions/runs/" + input.data.runId,
      token,
    ),
    artifact = await github(
      r,
      project.repository,
      "/actions/artifacts/" + input.data.artifactId,
      token,
    );
  if (
    run.id !== input.data.runId ||
    run.repository?.id !== repo.id ||
    run.head_sha !== record.revision ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    artifact.id !== input.data.artifactId ||
    artifact.expired !== false ||
    artifact.workflow_run?.id !== run.id ||
    artifact.workflow_run?.head_sha !== record.revision ||
    artifact.digest !== "sha256:" + record.target.artifactSha256
  )
    throw new JobError(
      409,
      "GitHub run, repository, source commit and artifact digest must all match the executed assessment.",
    );
  const payload = {
      provider: "github-actions-api",
      runId: run.id,
      artifactId: artifact.id,
      repositoryId: repo.id,
      revision: record.revision,
      artifactSha256: record.target.artifactSha256,
      reportDigest: createHash("sha256")
        .update(canonical(record))
        .digest("hex"),
      verifiedAt: new Date().toISOString(),
      limitation:
        "GitHub build identity plus independently hashed artifact bytes. This is not an independent rebuild or verification of an AWS-stored upload.",
    },
    c = await r.database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE",[id]);
    await c.query(
      "INSERT INTO qa_build_provenance(project_id,record_id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(project_id,record_id) DO UPDATE SET payload=EXCLUDED.payload",
      [id, input.data.recordId, JSON.stringify(payload)],
    );
    await appendLedger(
      r,
      c.query.bind(c),
      id,
      "build-provenance",
      "provenance:" + input.data.recordId + ":" + createHash("sha256").update(canonical(payload)).digest("hex"),
      payload,
      actor,
      input.data.recordId,
    );
    await c.query("COMMIT");
    return { provenance: payload };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function automaticProvenance(
  r: Runtime,
  id: string,
  recordId: string,
) {
  const job = (
    await r.database.query<{ payload: any }>(
      "SELECT payload FROM qa_jobs WHERE project_id=$1 AND record_id=$2 AND status=$3",
      [id, recordId, "completed"],
    )
  ).rows[0];
  if (job?.payload.githubBuild) {
    try {
      await verifyBuildProvenance(
        r,
        id,
        { recordId, ...job.payload.githubBuild },
        "Verified CI manifest",
      );
    } catch {
      /* Missing or rejected provenance blocks deployment; no result is fabricated. */
    }
  }
}
