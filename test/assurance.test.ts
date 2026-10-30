import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createPGliteDatabase } from "../src/lib/server/database";
import { createAuth, migrateDatabase } from "../src/lib/server/auth";
import { handleRequest } from "../src/lib/server/api";
import { secureSession, cookieJar } from "./auth-session";
import type { Runtime } from "../src/lib/server/runtime";
import {rolloutDecision} from "../src/lib/server/pilot-assurance";
import {TestingProfileSchema} from "../src/lib/jobs";
import { sealProvider } from "../src/lib/server/provider-vault";
const config = {
  origin: "https://portal.example",
  secret: "assurance-tests-only-at-least-32-characters",
  production: false,
  ledgerAllowedOrigins: ["https://ledger.example"],
  sendSignInLink: async ({ email, url }: { email: string; url: string }) => {
    links.set(email, url);
  },
};
const links = new Map<string, string>(),
  cookies: Record<string, string> = {},
  users: Record<string, string> = {};
let runtime: Runtime,
  project: string,
  suite: string,
  ids: string[] = [];
const hash = (v: string) => createHash("sha256").update(v).digest("hex"),
  revision = "a".repeat(40),
  repository = "fixture/assurance";
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  who = "owner",
  agent?: string,
) {
  return handleRequest(
    new Request(config.origin + path, {
      method,
      headers: {
        origin: config.origin,
        "content-type": "application/json",
        "x-forwarded-for":
          "192.0.2." +
          (100 + ["owner", "qa", "admin", "viewer", "outsider"].indexOf(who)),
        ...(agent
          ? { authorization: "Bearer " + agent }
          : { cookie: cookies[who] || "" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    runtime,
  );
}
const root = () => "/api/projects/" + project;
function report(
  recordId: string,
  checks: any[] = [
    {
      id: "probe",
      name: "Probe",
      method: "automated",
      required: true,
      status: "passed",
    },
  ],
) {
  return {
    schemaVersion: 1,
    recordId,
    repository,
    pr: { number: 1, title: "Fixture" },
    revision,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    phase: "completed",
    checks,
    findings: [],
    ai: {
      backend: "local",
      model: "deterministic-fixture",
      costUsd: 0,
      costIsEstimate: false,
      calls: 0,
    },
    limitations: ["Synthetic test fixture; not real product execution."],
  };
}
before(async () => {
  const db = await createPGliteDatabase();
  await migrateDatabase(db, config);
  runtime = { database: db, config, auth: createAuth(db, config) };
  for (const who of ["owner", "qa", "admin", "viewer", "outsider"]) {
    await api(
      "/api/auth/sign-in/magic-link",
      "POST",
      { email: who + "@example.test", name: who },
      who,
    );
    const u = new URL(links.get(who + "@example.test")!),
      r = await api(u.pathname + u.search, "GET", undefined, who);
    cookies[who] = await secureSession(runtime, cookieJar("", r));
    users[who] = (await runtime.auth.api.getSession({
      headers: new Headers({ cookie: cookies[who] }),
    }))!.user.id;
  }
  const r = await api("/api/projects", "POST", {
    name: "Assurance fixture",
    repository,
  });
  project = (await r.json()).project.id;
  for (const who of ["qa", "admin", "viewer"])
    await db.query(
      "INSERT INTO qa_members(project_id,user_id,role) VALUES($1,$2,$3)",
      [project, users[who], who],
    );
});
after(() => runtime.database.end());
test("advisory rollout is explicit and unqualified promotion cannot be forced", async () => {
  const state = await (await api(root() + "/assurance")).json();
  assert.equal(state.policy.mode, "advisory");
  assert.equal(state.eligible, false);
  assert.equal(
    (
      await api(root() + "/assurance", "PATCH", {
        ...state.policy,
        mode: "enforced",
      })
    ).status,
    409,
  );
  assert.equal(
    (await api(root() + "/assurance", "PATCH", state.policy, "admin")).status,
    403,
  );
  assert.equal(
    (await api(root() + "/assurance", "GET", undefined, "outsider")).status,
    404,
  );
});
test("label review and observations require different reviewers, real completed reports and jobs after review", async () => {
  const cases = Array.from({ length: 20 }, (_, i) => ({
    id: "case-" + i,
    expected: i % 2 ? "clean" : "defect",
    checkId: "check-" + i,
    requirement: "Known fixture behavior " + i,
  }));
  const created = await api(
    root() + "/pilots",
    "POST",
    {
      name: "Production fixture labels",
      kind: "production",
      repository,
      revision,
      cases,
    },
    "qa",
  );
  assert.equal(created.status, 200, await created.clone().text());
  suite = (await created.json()).id;
  assert.equal(
    (await api(root() + "/pilots/" + suite + "/review", "POST", {}, "qa"))
      .status,
    403,
  );
  assert.equal(
    (await api(root() + "/pilots/" + suite + "/review", "POST", {})).status,
    200,
  );
  for (let group = 0; group < 5; group++) {
    const rid = hash("fixture-assessment-" + group),
      items = cases.slice(group * 4, group * 4 + 4),
      payload = report(
        rid,
        items.map((c) => ({
          id: c.checkId,
          name: c.requirement,
          method: "automated",
          required: true,
          status: c.expected === "defect" ? "failed" : "passed",
        })),
      );
    ids.push(rid);
    await runtime.database.query(
      "INSERT INTO qa_runs(project_id,record_id,payload) VALUES($1,$2,$3::jsonb)",
      [project, rid, JSON.stringify(payload)],
    );
    if (group === 0)
      assert.equal(
        (
          await api(
            root() + "/pilots/" + suite + "/observe",
            "POST",
            { caseId: items[0].id, recordId: rid },
            "qa",
          )
        ).status,
        409,
      );
    await runtime.database.query(
      "INSERT INTO qa_jobs(id,project_id,dedupe_key,payload,status,record_id) VALUES($1,$2,$3,$4::jsonb,$5,$6)",
      [randomUUID(), project, randomUUID(), "{}", "completed", rid],
    );
    await runtime.database.query(
      "INSERT INTO qa_usage(project_id,record_id,payload) VALUES($1,$2,$3::jsonb)",
      [
        project,
        rid,
        JSON.stringify({ inferenceUsd: 0, infrastructureUsd: 0.01 }),
      ],
    );
    for (const c of items) {
      const linked = await api(
        root() + "/pilots/" + suite + "/observe",
        "POST",
        { caseId: c.id, recordId: rid },
        "qa",
      );
      assert.equal(linked.status, 200, await linked.clone().text());
    }
  }
  assert.equal(
    (
      await api(
        root() + "/pilots/" + suite + "/observe",
        "POST",
        { caseId: "case-0", recordId: ids[1] },
        "qa",
      )
    ).status,
    409,
  );
  const state = await (await api(root() + "/assurance")).json();
  assert.equal(state.productionMetrics.detected, 10);
  assert.equal(state.productionMetrics.recall, 1);
  assert.equal(state.productionMetrics.falseAlarmRate, 0);
  assert.equal(state.costs.assessments, 5);
  assert.equal(
    state.eligible,
    false,
    "Independent assessment evidence still missing.",
  );
});
test("reviewed evidence enables only qualified rollout; unknown costs and stale records close the gate again", async () => {
  const supplied = await api(root() + "/assurance-evidence", "POST", {
    kind: "security-review",
    title: "Fixture review",
    issuer: "Fixture assessor",
    artifactSha256: "c".repeat(64),
    reference: "private-fixture-document",
    conclusion: "Synthetic fixture only; not a real assessment.",
  });
  const evidence = (await supplied.json()).id;
  assert.equal(
    (
      await api(
        root() + "/assurance-evidence/" + evidence + "/review",
        "POST",
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        root() + "/assurance-evidence/" + evidence + "/review",
        "POST",
        {},
        "admin",
      )
    ).status,
    200,
  );
  let state = await (await api(root() + "/assurance")).json();
  assert.equal(state.eligible, true);
  assert.equal(
    (
      await api(root() + "/assurance", "PATCH", {
        ...state.policy,
        mode: "enforced",
      })
    ).status,
    200,
  );
  assert.equal(
    (await api(root() + "/assurance", "PATCH", state.policy)).status,
    409,
    "Stale policy versions cannot overwrite enforcement.",
  );
  // A qualified protocol fixture must be capable of authorizing a healthy,
  // fresh, server-enrolled assessment; rejecting every release is not success.
  const original=(await runtime.database.query<any>('SELECT settings,testing_profile FROM projects WHERE id=$1',[project])).rows[0];
  const profile=TestingProfileSchema.parse({previewUrlTemplate:'https://qualified.fixture',goals:{schemaVersion:1,goals:[{id:'positive',name:'Positive fixture',start:'/',requirement:'Known fixture requirement',inputs:{},assertions:[{id:'heading',action:'expectText',selector:'h1',text:'Fixture'}]}]}}),settings={...original.settings,roles:['planner'],backend:'local',model:'fixture'};
  const recordId=hash('qualified-positive-protocol'),jobId=randomUUID(),healthy=report(recordId,['goal-positive','replay-positive'].map(id=>({id,name:id,method:'automated',required:true,status:'passed'})));
  try{
    await runtime.database.query('UPDATE projects SET settings=$2::jsonb,testing_profile=$3::jsonb WHERE id=$1',[project,JSON.stringify(settings),JSON.stringify(profile)]);
    await runtime.database.query('INSERT INTO qa_runs(project_id,record_id,payload) VALUES($1,$2,$3::jsonb)',[project,recordId,JSON.stringify(healthy)]);
    await runtime.database.query("INSERT INTO qa_jobs(id,project_id,dedupe_key,payload,status,record_id) VALUES($1,$2,$3,$4::jsonb,'completed',$5)",[jobId,project,randomUUID(),JSON.stringify({schemaVersion:1,id:jobId,repository,revision,pr:{number:1},settings,testingProfile:profile,unitTests:[],base:'main'}),recordId]);
    assert.equal((await rolloutDecision(runtime,project,recordId)).releaseAuthorized,true,'Qualified healthy fixture can pass.');
    await runtime.database.query('UPDATE projects SET testing_profile=$2::jsonb WHERE id=$1',[project,JSON.stringify({...profile,previewUrlTemplate:'https://different.fixture'})]);
    const changed=await rolloutDecision(runtime,project,recordId);assert.equal(changed.releaseAuthorized,false);assert.ok(changed.reasons.some(v=>v.includes('configuration differs')));
    await runtime.database.query('UPDATE projects SET testing_profile=$2::jsonb WHERE id=$1',[project,JSON.stringify(profile)]);
    await runtime.database.query("UPDATE qa_runs SET payload=jsonb_set(payload,'{completedAt}',to_jsonb($3::text)) WHERE project_id=$1 AND record_id=$2",[project,recordId,new Date(Date.now()-7200000).toISOString()]);
    assert.equal((await rolloutDecision(runtime,project,recordId)).releaseAuthorized,false,'A formerly eligible fixture cannot authorize with stale evidence.');
  }finally{await runtime.database.query('UPDATE projects SET settings=$2::jsonb,testing_profile=$3::jsonb WHERE id=$1',[project,JSON.stringify(original.settings),JSON.stringify(original.testing_profile)]);}
  await runtime.database.query(
    "UPDATE qa_usage SET payload='{}'::jsonb WHERE project_id=$1 AND record_id=$2",
    [project, ids[0]],
  );
  state = await (await api(root() + "/assurance")).json();
  assert.equal(state.eligible, false);
  assert.equal(state.costs.unknownInfrastructure, 1);
  await runtime.database.query(
    "DELETE FROM qa_runs WHERE project_id=$1 AND record_id=$2",
    [project, ids[0]],
  );
  state = await (await api(root() + "/assurance")).json();
  assert.equal(state.productionMetrics.missing, 4);
  assert.equal(state.eligible, false);
});
test("Ledger archives actual report versions, verifies hashes, enforces project access and expires payloads without rewriting receipts", async () => {
  const rid = hash("immutable-ledger-fixture"),
    issued = await api(root() + "/token", "POST", {});
  assert.equal(issued.status, 200, await issued.clone().text());
  const token = (await issued.json()).token;
  assert.equal(
    (await api("/api/agent/runs/" + rid, "PUT", report(rid), "owner", token))
      .status,
    200,
  );
  let state = await (await api(root() + "/ledger")).json(),
    entry = state.entries.find((e: any) => e.record_id === rid);
  assert.ok(entry);
  const count = state.entries.length;
  assert.equal(
    (await api("/api/agent/runs/" + rid, "PUT", report(rid), "owner", token))
      .status,
    200,
  ); // Timestamps may produce a new immutable version.
  const snap = await (await api(root() + "/ledger/" + entry.id)).json();
  assert.equal(snap.checks[0].status, "passed");
  assert.equal(
    (await api(root() + "/ledger/" + entry.id, "GET", undefined, "outsider"))
      .status,
    404,
  );
  await assert.rejects(
    runtime.database.query(
      "UPDATE qa_assessment_ledger SET payload_digest=$2 WHERE id=$1",
      [entry.id, "f".repeat(64)],
    ),
    /append-only/,
  );
  await assert.rejects(
    runtime.database.query("DELETE FROM qa_assessment_ledger WHERE id=$1", [
      entry.id,
    ]),
    /append-only/,
  );
  const changed = report(rid, [
    {
      id: "probe",
      name: "Probe",
      method: "automated",
      required: true,
      status: "failed",
    },
  ]);
  assert.equal(
    (await api("/api/agent/runs/" + rid, "PUT", changed, "owner", token))
      .status,
    200,
  );
  assert.equal(
    (await (await api(root() + "/ledger/" + entry.id)).json()).checks[0].status,
    "passed",
  );
  assert.ok(
    (await (await api(root() + "/ledger")).json()).entries.length >= count + 1,
  );
  const chain = await (await api(root() + "/ledger/verify")).json();
  assert.equal(chain.valid, true);
  assert.equal(chain.complete, true);
  await runtime.database.query(
    "UPDATE qa_ledger_payloads SET expires_at=now()-interval '1 second' WHERE entry_id=$1",
    [entry.id],
  );
  assert.equal((await api(root() + "/ledger/" + entry.id)).status, 404);
  assert.equal(
    (await (await api(root() + "/ledger/verify")).json()).valid,
    true,
  );
});
test("Java Ledger delivery uses only scoped encrypted credentials, verifies returned digests and safely repeats identical PUTs", async () => {
  const remote = randomUUID(),
    scoped = "psl_" + "x".repeat(43),
    calls: any[] = [];
  runtime.ledgerFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer " + scoped,
    );
    if (String(url).endsWith("/project"))
      return Response.json({
        projectId: remote,
        repository,
        capabilities: ["assessment-archive-v1"],
      });
    const parts = new URL(String(url)).pathname.split("/");
    return Response.json({
      projectId: remote,
      recordId: parts.at(-2),
      payloadDigest: parts.at(-1),
      archived: true,
    });
  };
  assert.equal(
    (
      await api(root() + "/ledger/connect", "POST", {
        origin: "https://unapproved.example",
        token: scoped,
        approveAssessmentTransfer: true,
      })
    ).status,
    403,
  );
  const connected = await api(root() + "/ledger/connect", "POST", {
    origin: "https://ledger.example",
    token: scoped,
    approveAssessmentTransfer: true,
  });
  assert.equal(connected.status, 200, await connected.clone().text());
  const saved = (
    await runtime.database.query<{ encrypted: Uint8Array }>(
      "SELECT encrypted FROM qa_ledger_connections WHERE project_id=$1",
      [project],
    )
  ).rows[0];
  assert.ok(!Buffer.from(saved.encrypted).includes(Buffer.from(scoped)));
  await api(root() + "/ledger/deliver", "POST", {});
  const state = await (await api(root() + "/ledger")).json();
  assert.ok(state.entries.some((e: any) => e.archive_status === "confirmed"));
  assert.ok(calls.some((c) => c.options.method === "PUT"));
  assert.ok(!JSON.stringify(state).includes(scoped));
});

test("build provenance requires the exact successful GitHub workflow, artifact digest and hosted byte-check evidence", async () => {
  const rid = hash("build-provenance-fixture"),
    artifact = "d".repeat(64),
    p: any = report(
      rid,
      ["release-artifact", "release-artifact-stability"].map((id) => ({
        id,
        name: id,
        method: "automated",
        required: true,
        status: "passed",
      })),
    );
  delete p.pr;
  p.target = {
    kind: "build",
    name: "build-42",
    platform: "web",
    artifactSha256: artifact,
  };
  await runtime.database.query(
    "INSERT INTO qa_runs(project_id,record_id,payload) VALUES($1,$2,$3::jsonb)",
    [project, rid, JSON.stringify(p)],
  );
  await runtime.database.query(
    "INSERT INTO qa_jobs(id,project_id,dedupe_key,payload,status,record_id,execution_mode) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)",
    [randomUUID(), project, randomUUID(), "{}", "completed", rid, "hosted"],
  );
  await runtime.database.query(
    "INSERT INTO qa_provider_credentials(project_id,provider,encrypted,suffix,version) VALUES($1,'github',$2,'fake',nextval('qa_provider_generation'))",
    [
      project,
      sealProvider(
        runtime,
        project,
        "fixture-github-read-only-token",
        "github",
      ),
    ],
  );
  let valid = true;
  runtime.repositoryFetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/user")
      return Response.json({ id: 42, login: "fixture-admin" });
    if (path.endsWith("/permission"))
      return Response.json({ permission: "admin", user: { id: 42 } });
    if (path.includes("/actions/runs/"))
      return Response.json({
        id: 55,
        repository: { id: 77 },
        head_sha: revision,
        status: "completed",
        conclusion: "success",
      });
    if (path.includes("/actions/artifacts/"))
      return Response.json({
        id: 66,
        expired: false,
        workflow_run: { id: 55, head_sha: revision },
        digest: "sha256:" + (valid ? artifact : "e".repeat(64)),
      });
    return Response.json({ id: 77, full_name: repository });
  };
  const request = { recordId: rid, runId: 55, artifactId: 66 };
  assert.equal(
    (await api(root() + "/build-provenance", "POST", request, "qa")).status,
    200,
  );
  valid = false;
  assert.equal(
    (await api(root() + "/build-provenance", "POST", request, "qa")).status,
    409,
  );
  assert.ok(
    (await (await api(root() + "/ledger")).json()).entries.some(
      (e: any) => e.event_type === "build-provenance",
    ),
  );
});

test("project deletion erases retained ledger data while individual history edits remain forbidden", async () => {
  assert.equal((await api(root(), "DELETE", {})).status, 200);
  assert.equal(
    (
      await runtime.database.query(
        "SELECT id FROM qa_assessment_ledger WHERE project_id=$1",
        [project],
      )
    ).rows.length,
    0,
  );
});
