import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createPGliteDatabase } from "../src/lib/server/database";
import { createAuth, migrateDatabase } from "../src/lib/server/auth";
import { handleRequest } from "../src/lib/server/api";
import { secureSession, cookieJar } from "./auth-session";
import type { Runtime } from "../src/lib/server/runtime";
import {
  archiveStored,
  assessmentDigest,
  ledgerPayload,
  verifyLedger,
} from "../src/lib/server/assessment-ledger";
import {
  connectLedger,
  deliverLedger,
  reconcileLedger,
} from "../src/lib/server/ledger-bridge";
import { rolloutDecision } from "../src/lib/server/pilot-assurance";
import { saveUsage } from "../src/lib/server/quality";
import { providerKey, sealProvider } from "../src/lib/server/provider-vault";
const links = new Map<string, string>(),
  cookies: Record<string, string> = {},
  users: Record<string, string> = {};
const config = {
  origin: "https://portal.example",
  secret: "enterprise-hardening-fixture-secret-at-least-32",
  production: false,
  ledgerAllowedOrigins: ["https://ledger.example"],
  cronSecret: "fixture-operator-secret-at-least-32-characters",
  sendSignInLink: async ({ email, url }: { email: string; url: string }) => {
    links.set(email, url);
  },
};
let r: Runtime, id: string, other: string;
const repository = "fixture/hardening",
  revision = "a".repeat(40),
  rid = createHash("sha256").update("hardening-report").digest("hex");
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  who = "owner",
) {
  return handleRequest(
    new Request(config.origin + path, {
      method,
      headers: {
        origin: config.origin,
        cookie: cookies[who] || "",
        "content-type": "application/json",
        "x-forwarded-for": who === "owner" ? "192.0.2.220" : "192.0.2.221",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    r,
  );
}
const root = () => "/api/projects/" + id;
const report = () => ({
  schemaVersion: 1,
  recordId: rid,
  repository,
  revision,
  pr: { number: 1, title: "Synthetic acceptance" },
  phase: "completed",
  createdAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  checks: [
    {
      id: "order-data",
      name: "Resulting order is correct",
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
  limitations: ["Synthetic protocol fixture; not a customer qualification."],
});
before(async () => {
  const database = await createPGliteDatabase();
  await migrateDatabase(database, config);
  r = { database, config, auth: createAuth(database, config) };
  for (const who of ["owner", "viewer", "outsider"]) {
    await api(
      "/api/auth/sign-in/magic-link",
      "POST",
      { email: who + "@fixture.test", name: who },
      who,
    );
    const u = new URL(links.get(who + "@fixture.test")!);
    const response = await api(u.pathname + u.search, "GET", undefined, who);
    cookies[who] = await secureSession(r, cookieJar("", response));
    users[who] = (await r.auth.api.getSession({
      headers: new Headers({ cookie: cookies[who] }),
    }))!.user.id;
  }
  id = (
    await (
      await api("/api/projects", "POST", {
        name: "Hardening fixture",
        repository,
      })
    ).json()
  ).project.id;
  other = (
    await (
      await api(
        "/api/projects",
        "POST",
        { name: "Other organization", repository: "fixture/other" },
        "outsider",
      )
    ).json()
  ).project.id;
  await database.query(
    "INSERT INTO qa_members(project_id,user_id,role) VALUES($1,$2,'viewer')",
    [id, users.viewer],
  );
  await database.query(
    "INSERT INTO qa_runs(project_id,record_id,payload) VALUES($1,$2,$3::jsonb)",
    [id, rid, JSON.stringify(report())],
  );
  await archiveStored(r, id, rid);
});
after(() => r.database.end());
test("inferred requirements remain drafts; explicit approval and every correction preserve original versions", async () => {
  const input = {
    title: "Order ownership",
    acceptance: "Orders belong to the signed-in buyer.",
    risk: "critical",
    category: "api",
    checkIds: ["order-data"],
    goalIds: [],
    active: true,
    expectedVersion: 0,
    origin: "inferred",
    approval: "approved",
    behaviorType: "business-rule",
  };
  assert.equal(
    (await api(root() + "/requirements", "POST", input)).status,
    400,
  );
  const draft = await api(root() + "/requirements", "POST", {
    ...input,
    approval: "draft",
  });
  assert.equal(draft.status, 201, await draft.clone().text());
  const req = (await draft.json()).requirement;
  let quality = await (await api(root() + "/quality")).json();
  assert.equal(quality.plan.requirements.length, 0);
  assert.equal(
    (
      await api(root() + "/requirements/" + req.id, "PATCH", {
        ...input,
        origin: "customer",
        approval: "approved",
        expectedVersion: 1,
      })
    ).status,
    200,
  );
  quality = await (await api(root() + "/quality")).json();
  assert.equal(quality.plan.requirements.length, 1);
  assert.equal(
    quality.plan.requirements[0].origin,
    undefined,
    "Engine contract remains backward compatible.",
  );
  const entries = (await (await api(root() + "/ledger")).json()).entries.filter(
    (e: any) => e.event_type === "requirement-version",
  );
  assert.equal(entries.length, 2);
  const original = await ledgerPayload(
    r,
    id,
    entries.find((e: any) => e.event_key.endsWith(":1")).id,
  );
  assert.equal(original.payload.approval, "draft");
});
test("authored test edits and deletion retain original assertions in the existing ledger", async () => {
  const created = await api(root() + "/tests", "POST", {
    name: "Order amount",
    framework: "node",
    source: "import assert from 'node:assert/strict'; assert.equal(1,1);",
    enabled: true,
  });
  assert.equal(created.status, 201, await created.clone().text());
  const t = (await created.json()).test;
  assert.equal(
    (
      await api(root() + "/tests/" + t.id, "PATCH", {
        version: 1,
        test: {
          name: t.name,
          framework: "node",
          source: "import assert from 'node:assert/strict'; assert.equal(2,2);",
          enabled: true,
        },
      })
    ).status,
    200,
  );
  assert.equal((await api(root() + "/tests/" + t.id, "DELETE")).status, 200);
  const entries = (await (await api(root() + "/ledger")).json()).entries.filter(
    (e: any) => e.event_key.includes(t.id),
  );
  assert.equal(entries.length, 3);
  assert.equal(
    (
      await ledgerPayload(
        r,
        id,
        entries.find((e: any) => e.event_key.endsWith(":1")).id,
      )
    ).source,
    t.source,
  );
});
test("usage corrections retain previous measured/estimated/unknown accounting instead of overwriting history", async () => {
  const usage = {
    durationMs: 100,
    inferenceUsd: 0,
    infrastructureUsd: null,
    humanMinutes: null,
    costIsEstimate: false,
  };
  await saveUsage(r, id, rid, usage);
  await saveUsage(r, id, rid, {
    ...usage,
    humanMinutes: 3,
    costIsEstimate: true,
  });
  const entries = (await (await api(root() + "/ledger")).json()).entries.filter(
    (e: any) => e.event_type === "usage-version",
  );
  assert.equal(entries.length, 2);
  const latest = await ledgerPayload(r, id, entries[0].id);
  assert.equal(latest.previous.humanMinutes, null);
  assert.equal(latest.usage.humanMinutes, 3);
  assert.equal(latest.source, "runner-supplied; not independent billing");
});
test("archive retries are bounded, stale last attempts become failed, and reconciliation revokes a missing receipt", async () => {
  const remote = randomUUID(),
    scoped = "psl_" + "x".repeat(43);
  let outage = false,
    wrong = false,
    puts = 0;
  r.ledgerFetch = async (url, opts) => {
    if (String(url).endsWith("/project"))
      return Response.json({
        projectId: remote,
        repository,
        capabilities: ["assessment-archive-v1"],
      });
    if (outage) throw Error("fixture provider outage");
    const parts = new URL(String(url)).pathname.split("/");
    if (opts?.method === "PUT") puts++;
    return Response.json({
      projectId: remote,
      recordId: parts.at(-2),
      payloadDigest: wrong ? "f".repeat(64) : parts.at(-1),
      archived: true,
    });
  };
  await connectLedger(
    r,
    id,
    {
      origin: "https://ledger.example",
      token: scoped,
      approveAssessmentTransfer: true,
    },
    "Fixture owner",
  );
  outage = true;
  for (let i = 0; i < 3; i++) await deliverLedger(r, id);
  let d = (
    await r.database.query<any>(
      "SELECT * FROM qa_ledger_delivery WHERE entry_id IN(SELECT id FROM qa_assessment_ledger WHERE project_id=$1)",
      [id],
    )
  ).rows[0];
  assert.equal(d.status, "failed");
  assert.equal(d.attempts, 3);
  await r.database.query(
    "UPDATE qa_ledger_delivery SET status='sending',claimed_at=now()-interval '3 minutes' WHERE entry_id=$1",
    [d.entry_id],
  );
  await deliverLedger(r, id);
  d = (
    await r.database.query<any>(
      "SELECT * FROM qa_ledger_delivery WHERE entry_id=$1",
      [d.entry_id],
    )
  ).rows[0];
  assert.equal(d.status, "failed");
  await r.database.query(
    "UPDATE qa_ledger_delivery SET status='pending',attempts=0 WHERE entry_id=$1",
    [d.entry_id],
  );
  outage = false;
  await deliverLedger(r, id);
  assert.equal(puts, 1);
  wrong = true;
  await reconcileLedger(r, id);
  assert.equal(
    (
      await r.database.query<any>(
        "SELECT status FROM qa_ledger_delivery WHERE entry_id=$1",
        [d.entry_id],
      )
    ).rows[0].status,
    "conflict",
  );
});
test("archive acknowledgment is opt-in and bound to the exact report version and configured destination", async () => {
  // Directly seeded enforcement is a protocol fixture, not evidence of qualification.
  await r.database.query(
    "INSERT INTO qa_assurance_policy(project_id,payload) VALUES($1,$2::jsonb)",
    [
      id,
      JSON.stringify({ mode: "enforced", requireArchiveAcknowledgment: true }),
    ],
  );
  let decision = await rolloutDecision(r, id, rid);
  assert.ok(decision.reasons.some((v) => v.includes("not acknowledged")));
  const remote = (
    await r.database.query<any>(
      "SELECT remote_project FROM qa_ledger_connections WHERE project_id=$1",
      [id],
    )
  ).rows[0].remote_project;
  await r.database.query(
    "UPDATE qa_ledger_delivery SET status='confirmed',destination_origin='https://ledger.example',destination_project=$2,receipt=$3::jsonb WHERE entry_id IN(SELECT id FROM qa_assessment_ledger WHERE project_id=$1 AND event_type='assessment')",
    [
      id,
      remote,
      JSON.stringify({
        projectId: remote,
        recordId: rid,
        payloadDigest: assessmentDigest(report()),
        archived: true,
      }),
    ],
  );
  // Timestamps are part of the digest; use the exact retained snapshot.
  const retained = (
    await r.database.query<any>(
      "SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2",
      [id, rid],
    )
  ).rows[0].payload;
  await r.database.query(
    "UPDATE qa_ledger_delivery SET receipt=jsonb_set(receipt,'{payloadDigest}',to_jsonb($2::text)) WHERE entry_id IN(SELECT id FROM qa_assessment_ledger WHERE project_id=$1 AND event_type='assessment')",
    [id, assessmentDigest(retained)],
  );
  decision = await rolloutDecision(r, id, rid);
  assert.ok(!decision.reasons.some((v) => v.includes("not acknowledged")));
  await r.database.query(
    "UPDATE qa_ledger_connections SET remote_project=$2 WHERE project_id=$1",
    [id, randomUUID()],
  );
  decision = await rolloutDecision(r, id, rid);
  assert.ok(decision.reasons.some((v) => v.includes("not acknowledged")));
});
test("lost or expired evidence and stale PR assessments cannot authorize a release", async () => {
  await r.database.query(
    'UPDATE qa_assurance_policy SET payload=payload||\'{"requireArchiveAcknowledgment":false,"requireRetainedEvidence":true}\'::jsonb WHERE project_id=$1',
    [id],
  );
  let decision = await rolloutDecision(r, id, rid);
  assert.ok(decision.reasons.some((v) => v.includes("Retained evidence")));
  await r.database.query(
    "UPDATE qa_runs SET payload=jsonb_set(payload,'{completedAt}',to_jsonb($3::text)) WHERE project_id=$1 AND record_id=$2",
    [id, rid, new Date(Date.now() - 7200000).toISOString()],
  );
  decision = await rolloutDecision(r, id, rid);
  assert.ok(decision.reasons.some((v) => v.includes("one hour")));
  assert.equal(decision.releaseAuthorized, false);
});
test("release history retrieval rechecks membership, tenant scope and viewer write restrictions", async () => {
  const history = await api(root() + "/ledger/history?recordId=" + rid);
  assert.equal(history.status, 200);
  const body = await history.json();
  assert.ok(body.events.length);
  assert.equal(body.projectId, id);
  assert.equal(
    (
      await api(
        "/api/projects/" + other + "/ledger/history?recordId=" + rid,
        "GET",
        undefined,
        "outsider",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        root() + "/ledger/history?recordId=" + rid,
        "GET",
        undefined,
        "outsider",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        root() + "/ledger/history?recordId=" + rid,
        "GET",
        undefined,
        "viewer",
      )
    ).status,
    200,
  );
  assert.equal(
    (await api(root() + "/ledger/deliver", "POST", {}, "viewer")).status,
    403,
  );
  await r.database.query(
    "DELETE FROM qa_members WHERE project_id=$1 AND user_id=$2",
    [id, users.viewer],
  );
  assert.equal(
    (
      await api(
        root() + "/ledger/history?recordId=" + rid,
        "GET",
        undefined,
        "viewer",
      )
    ).status,
    404,
    "Existing sessions do not cache membership.",
  );
});
test("additive migration reruns preserve existing history, payload decryption and trigger protection", async () => {
  const before = await verifyLedger(r, id);
  await migrateDatabase(r.database, config);
  const after = await verifyLedger(r, id);
  assert.equal(after.valid, true);
  assert.equal(after.headHash, before.headHash);
  assert.equal(after.verifiedEntries, before.verifiedEntries);
  await assert.rejects(
    r.database.query("DELETE FROM qa_assessment_ledger WHERE project_id=$1", [
      id,
    ]),
    /append-only/,
  );
});
test("offboarding the owning machine principal immediately denies integration credential use and existing sessions", async () => {
  await r.database.query(
    "INSERT INTO qa_provider_credentials(project_id,provider,encrypted,suffix,version) VALUES($1,'github',$2,'fake',1)",
    [id, sealProvider(r, id, "fixture-github-credential", "github")],
  );
  assert.equal(
    (await providerKey(r, id, "github")).apiKey,
    "fixture-github-credential",
  );
  await r.database.query(
    "INSERT INTO qa_directory_users(id,project_id,email,active) VALUES($1,$2,'owner@fixture.test',false)",
    [randomUUID(), id],
  );
  await assert.rejects(providerKey(r, id, "github"), /offboarded/);
  assert.equal((await api(root() + "/ledger")).status, 404);
});

test("server recomputes the frozen denominator and rejects omitted, optional, analysis-only and stale goal evidence", async () => {
  const { executionEvidenceReasons } =
    await import("../src/lib/execution-evidence");
  const job: any = {
    repository,
    revision,
    pr: { number: 1 },
    testingProfile: { goals: { goals: [{ id: "checkout" }] } },
    unitTests: [],
  };
  const base: any = report();
  base.checks = ["goal-checkout", "replay-checkout"].map((id) => ({
    id,
    name: id,
    method: "automated",
    required: true,
    status: "passed",
  }));
  assert.deepEqual(executionEvidenceReasons(job, base), []);
  for (const checks of [
    base.checks.slice(0, 1),
    base.checks.map((c: any) => ({ ...c, required: false })),
    base.checks.map((c: any) => ({ ...c, method: "analysis" })),
  ])
    assert.ok(
      executionEvidenceReasons(job, { ...base, checks }).some((v) =>
        v.includes("Missing passing required"),
      ),
    );
  assert.ok(
    executionEvidenceReasons(job, {
      ...base,
      completedAt: new Date(Date.now() - 7200000).toISOString(),
    }).some((v) => v.includes("one hour")),
  );
});
test("human-work comparisons keep estimates and unpaired samples separate from measured reductions", async () => {
  const { recordPilotWork, pilotWorkState } =
    await import("../src/lib/server/pilot-work");
  // The owning identity was offboarded above: exercise the already-authorized
  // internal persistence contract without pretending browser access is allowed.
  const suiteId = randomUUID();
  await r.database.query(
    "INSERT INTO qa_pilot_suites(id,project_id,name,kind,payload,author_id) VALUES($1,$2,'Fixture work sample','controlled',$3::jsonb,$4)",
    [
      suiteId,
      id,
      JSON.stringify({ repository, revision, cases: [{ id: "order" }] }),
      users.owner,
    ],
  );
  const entry = {
    sampleId: "same-workload",
    workflow: "manual",
    basis: "measured",
    minutes: {
      setup: 3,
      maintenance: 2,
      triage: 2,
      approvals: 1,
      execution: 10,
    },
    note: "Synthetic time entry; not an actual manual baseline.",
  };
  await recordPilotWork(r, id, suiteId, entry, users.owner);
  await recordPilotWork(
    r,
    id,
    suiteId,
    { ...entry, workflow: "patchsentry", basis: "estimated" },
    users.owner,
  );
  let view = await pilotWorkState(r, id);
  assert.equal(view.comparisons[0].observedDifferenceMinutes, null);
  await recordPilotWork(
    r,
    id,
    suiteId,
    {
      ...entry,
      workflow: "patchsentry",
      minutes: {
        setup: 3,
        maintenance: 2,
        triage: 2,
        approvals: 1,
        execution: 0,
      },
    },
    users.owner,
  );
  view = await pilotWorkState(r, id);
  assert.equal(view.comparisons[0].observedDifferenceMinutes, 10);
  assert.equal(view.logs.length, 3);
  assert.match(view.notice, /does not establish headcount/);
});
test("scheduled operation health records success, failure and interrupted leases without leaking provider errors", async () => {
  const { trackedOperation, operationHealth } =
    await import("../src/lib/server/operations");
  await trackedOperation(r, "maintenance", async () => ({ fixture: true }));
  let view = await operationHealth(r);
  assert.equal(view.tasks[0].state, "succeeded");
  await assert.rejects(
    trackedOperation(r, "maintenance", async () => {
      throw Error("synthetic-secret-do-not-publish");
    }),
  );
  view = await operationHealth(r);
  assert.equal(view.tasks[0].state, "failed");
  assert.ok(!JSON.stringify(view).includes("synthetic-secret"));
  await r.database.query(
    "UPDATE qa_operation_health SET state='running',last_started_at=now() WHERE name='maintenance'",
  );
  let calls = 0;
  assert.deepEqual(
    await trackedOperation(r, "maintenance", async () => {
      calls++;
    }),
    { running: true },
  );
  assert.equal(calls, 0);
  await r.database.query(
    "UPDATE qa_operation_health SET last_started_at=now()-interval '11 minutes' WHERE name='maintenance'",
  );
  assert.equal((await operationHealth(r)).tasks[0].interrupted, true);
  await trackedOperation(r, "maintenance", async () => ({ recovered: true }));
  assert.equal((await operationHealth(r)).tasks[0].state, "succeeded");
});

test('paginated release history retrieves every retained decision exactly once across page boundaries',async()=>{
 const {appendLedger}=await import('../src/lib/server/assessment-ledger');const {releaseHistory}=await import('../src/lib/server/release-history');
 const c=await r.database.connect();const expected=new Set<string>();try{await c.query('BEGIN');for(let i=0;i<12;i++){const entry=await appendLedger(r,c.query.bind(c),id,'release-decision','fixture-pagination:'+i,{fixture:true,index:i,releaseAuthorized:false},'Fixture CI',rid);expected.add(entry.id);}await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const seen=new Set<string>();let before:number|undefined,pages=0;do{const page=await releaseHistory(r,id,rid,before);for(const entry of page.events){assert.ok(!seen.has(entry.id),'History pages must not repeat entries.');seen.add(entry.id);}pages++;before=page.nextBefore||undefined;}while(before);
 assert.ok(pages>=2);for(const entry of expected)assert.ok(seen.has(entry),'Every retained release decision must be retrievable.');
 await assert.rejects(releaseHistory(r,other,rid),/No retained Ledger history/);
});
