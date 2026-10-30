// Isolated recovery rehearsal only. Never accepts a production/remote database.
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase } from "../src/lib/server/database";
import { createAuth, migrateDatabase } from "../src/lib/server/auth";
import { handleRequest } from "../src/lib/server/api";
import { secureSession, cookieJar } from "../test/auth-session";
import {
  verifyLedger,
  ledgerPayload,
  assessmentDigest,
} from "../src/lib/server/assessment-ledger";
import { encrypt, downloadEvidence } from "../src/lib/server/evidence";
import { hostedBaselines } from "../src/lib/server/visual-baselines";
import { sealProvider, providerKey } from "../src/lib/server/provider-vault";
import {saveUsage} from "../src/lib/server/quality";
import type { Runtime } from "../src/lib/server/runtime";
const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  process.env.PS_ALLOW_FIXTURE_RECOVERY !== "1" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !/^\/ps_fixture_[a-z_]+$/.test(url.pathname)
)
  throw Error(
    "Recovery harness requires an explicit local ps_fixture_ database.",
  );
const mode = process.argv[2];
if (!["seed", "verify"].includes(mode)) throw Error("Use seed or verify.");
const database = await createDatabase({
    DATABASE_URL: url.href,
    NODE_ENV: "test",
  }),
  started = performance.now();
let link = "",
  cookie = "";
const config = {
  origin: "https://restore.fixture",
  production: false,
  secret: "restore-fixture-only-key-at-least-32-characters",
  sendSignInLink: async ({ url }: { url: string }) => {
    link = url;
  },
};
const r: Runtime = { database, config, auth: createAuth(database, config) };
const expectedPath =
  process.env.PS_RESTORE_EXPECTED ||
  "/private/tmp/patchsentry-restore-expected.json";
const sha = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
async function api(path: string, method = "GET", body?: unknown) {
  const response = await handleRequest(
    new Request(config.origin + path, {
      method,
      headers: {
        origin: config.origin,
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": "192.0.2.230",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    r,
  );
  assert.ok(response.status < 400, await response.clone().text());
  return response;
}
async function counts() {
  const names = [
    "projects",
    "user",
    "qa_members",
    "qa_runs",
    "qa_requirements",
    "qa_test_cases",
    "qa_evidence",
    "qa_visual_baselines",
    "qa_assessment_ledger",
    "qa_ledger_payloads",
    "qa_usage",
    "qa_provider_credentials",
  ];
  const output: Record<string, number> = {};
  for (const name of names)
    output[name] = Number(
      (
        await database.query<{ n: string }>(
          'SELECT count(*) AS n FROM "' + name + '"',
        )
      ).rows[0].n,
    );
  return output;
}
try {
  await migrateDatabase(database, config);
  if (mode === "seed") {
    assert.equal(
      Number(
        (
          await database.query<{ n: string }>(
            "SELECT count(*) AS n FROM projects",
          )
        ).rows[0].n,
      ),
      0,
      "Use an empty disposable database.",
    );
    await api("/api/auth/sign-in/magic-link", "POST", {
      email: "owner@restore.invalid",
      name: "Restore fixture",
    });
    const u = new URL(link),
      verified = await api(u.pathname + u.search);
    cookie = await secureSession(r, cookieJar("", verified));
    const project = (
        await (
          await api("/api/projects", "POST", {
            name: "Restore rehearsal only",
            repository: "fixture/recovery",
          })
        ).json()
      ).project,
      id = project.id,
      root = "/api/projects/" + id;
    await api(root + "/requirements", "POST", {
      title: "Persisted order amount",
      acceptance: "The stored order has the expected amount and owner.",
      risk: "critical",
      category: "api",
      checkIds: ["order-data"],
      goalIds: [],
      active: true,
      expectedVersion: 0,
    });
    await api(root + "/tests", "POST", {
      name: "Fixture unit assertion",
      framework: "node",
      source: "const assert=require('node:assert/strict'); assert.equal(1,1);",
      enabled: true,
    });
    const recordId = sha("recovery-fixture-assessment"),
      report = {
        schemaVersion: 1,
        recordId,
        repository: "fixture/recovery",
        revision: "a".repeat(40),
        pr: { number: 1, title: "Restore fixture" },
        phase: "completed",
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        checks: [
          {
            id: "order-data",
            name: "Order data assertion",
            method: "automated",
            required: true,
            status: "passed",
          },
        ],
        findings: [],
        ai: {
          backend: "local",
          model: "fixture",
          calls: 0,
          costUsd: 0,
          costIsEstimate: false,
        },
        limitations: ["Restore fixture only; no real QA evidence."],
      };
    const token = (await (await api(root + "/token", "POST", {})).json()).token;
    const uploaded = await handleRequest(
      new Request(config.origin + "/api/agent/runs/" + recordId, {
        method: "PUT",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify(report),
      }),
      r,
    );
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const evidenceId = randomUUID(),
      bytes = Buffer.from('{"fixture":"order evidence"}'),
      metadata = {
        id: evidenceId,
        checkId: "order-data",
        kind: "steps",
        name: "Recovery evidence",
        mime: "application/json",
        sha256: sha(bytes),
        bytes: bytes.length,
        summary: "Synthetic restore fixture",
        redacted: true,
      };
    await database.query(
      "INSERT INTO qa_evidence(project_id,id,record_id,metadata,bytes,encrypted,expires_at,report_digest) VALUES($1,$2,$3,$4::jsonb,$5,$6,now()+interval '1 day',$7)",
      [
        id,
        evidenceId,
        recordId,
        JSON.stringify(metadata),
        bytes.length,
        encrypt(r, id, evidenceId, bytes),
        assessmentDigest(report),
      ],
    );
    const baselineId = randomUUID(),
      png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKz8AAAAASUVORK5CYII=",
        "base64",
      );
    await database.query(
      "INSERT INTO qa_visual_baselines(project_id,key,candidate_id,metadata,encrypted,bytes,approved_by) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)",
      [
        id,
        sha("baseline"),
        baselineId,
        JSON.stringify({
          sha256: sha(png),
          key: sha("baseline"),
          revision: report.revision,
        }),
        encrypt(r, id, baselineId, png),
        png.length,
        "Fixture approval",
      ],
    );
    await database.query(
      "INSERT INTO qa_provider_credentials(project_id,provider,encrypted,suffix,version) VALUES($1,'github',$2,'ture',1)",
      [id, sealProvider(r, id, "restore-fixture-github-token", "github")],
    );
    const viewer=randomUUID();await database.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[viewer,'Restore viewer','viewer@restore.invalid']);await database.query("INSERT INTO qa_members(project_id,user_id,role) VALUES($1,$2,'viewer')",[id,viewer]);
    await saveUsage(r,id,recordId,{durationMs:100,inferenceUsd:0,infrastructureUsd:null,humanMinutes:null,costIsEstimate:false});
    const chain = await verifyLedger(r, id);
    await writeFile(
      expectedPath,
      JSON.stringify({
        id,
        recordId,
        evidenceId,
        sha: sha(bytes),
        baselineSha: sha(png),
        counts: await counts(),
        chain,
      }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        mode: "seed",
        fixtureOnly: true,
        counts: await counts(),
        durationMs: Math.round(performance.now() - started),
      }),
    );
  } else {
    const expected = JSON.parse(await readFile(expectedPath, "utf8"));
    assert.deepEqual(await counts(), expected.counts);
    assert.deepEqual(await verifyLedger(r, expected.id), expected.chain);
    const entries = (
      await database.query<{ id: string }>(
        "SELECT id FROM qa_assessment_ledger WHERE project_id=$1",
        [expected.id],
      )
    ).rows;
    for (const e of entries)
      assert.ok(await ledgerPayload(r, expected.id, e.id));
    const response = await downloadEvidence(
      r,
      expected.id,
      expected.evidenceId,
      "Recovery verifier",
    );
    assert.equal(sha(Buffer.from(await response.arrayBuffer())), expected.sha);
    const baselines = await hostedBaselines(r, expected.id);
    assert.equal(
      sha(Buffer.from(baselines[0].png, "base64")),
      expected.baselineSha,
    );
    assert.equal(
      (await providerKey(r, expected.id, "github")).apiKey,
      "restore-fixture-github-token",
    );
    await assert.rejects(
      database.query("DELETE FROM qa_assessment_ledger WHERE project_id=$1", [
        expected.id,
      ]),
      /append-only/,
    );
    console.log(
      JSON.stringify({
        mode: "verify",
        fixtureOnly: true,
        countsPreserved: true,
        ledgerChainAndPayloadsVerified: true,
        evidenceDecrypted: true,
        visualBaselineDecrypted: true,
        providerCredentialDecrypted: true,
        migrationRerun: true,
        appendOnlyGuard: true,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  }
} finally {
  await database.end();
}
