// Controlled deterministic integration rehearsal. GitHub and Java transport are
// fixtures; browser execution and API/data checks use the real QA engine.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createPGliteDatabase } from "../src/lib/server/database";
import { createAuth, migrateDatabase } from "../src/lib/server/auth";
import { handleRequest } from "../src/lib/server/api";
import { secureSession, cookieJar } from "../test/auth-session";
import { automationDefaults } from "../src/lib/automation";
import { policyDefaults } from "../src/lib/quality";
import { recoverExecutions } from "../src/lib/server/operations";
import {
  connectLedger,
  deliverLedger,
  reconcileLedger,
} from "../src/lib/server/ledger-bridge";
import {
  verifyLedger,
  ledgerPayload,
} from "../src/lib/server/assessment-ledger";
import type { Runtime } from "../src/lib/server/runtime";
const engine = process.env.PATCHSENTRY_ENGINE_DIR;
if (!engine)
  throw Error("Set PATCHSENTRY_ENGINE_DIR to the trusted QA-testbot checkout.");
const require = createRequire(import.meta.url),
  { runWebAudit } = require(join(resolve(engine), "src/web/audit.js"));
const output = resolve(process.env.PS_E2E_OUTPUT || "artifacts/enterprise-e2e");
await mkdir(output, { recursive: true });
const product = join(output, "fixture-product");
await mkdir(product);
const git = (args: string[]) =>
  execFileSync("git", args, { cwd: product, encoding: "utf8" }).trim();
git(["init", "-q"]);
git(["config", "user.name", "Synthetic QA fixture"]);
git(["config", "user.email", "fixture@example.invalid"]);
const cases = [
  { id: "healthy", expected: "passed" },
  { id: "wrong-amount", expected: "failed" },
  { id: "permission", expected: "failed" },
  { id: "async", expected: "failed" },
  { id: "wrong-revision", expected: "blocked" },
  { id: "worker-interrupted", expected: "blocked" },
];
await writeFile(
  join(output, "labels-before-execution.json"),
  JSON.stringify(
    { scope: "controlled fixture; not a production qualification", cases },
    null,
    2,
  ),
);
let mode = "healthy",
  revision = "a".repeat(40),
  link = "",
  cookie = "";
const orders = new Map<string, unknown>(),
  tasks: (() => Promise<unknown>)[] = [];
const source = `Disposable checkout fixture. UI creates order; API must preserve amount=42, owner=buyer; viewers cannot read administration. Healthy, wrong-amount, permission and async defect modes are predefined before execution. Mutable test data is memory-only.`;
await writeFile(join(product, "fixture-source.txt"), source);
const server = http.createServer((request, response) => {
  response.setHeader(
    "x-qa-revision",
    mode === "wrong-revision" ? "b".repeat(40) : revision,
  );
  const session =
    request.headers.cookie?.match(/fixture_session=([a-f0-9-]+)/)?.[1] || "";
  if (request.url === "/") {
    response.setHeader(
      "set-cookie",
      "fixture_session=" + randomUUID() + "; Path=/; HttpOnly; SameSite=Lax",
    );
    response.setHeader("content-type", "text/html");
    response.end(
      '<!doctype html><html lang="en"><head><title>Checkout fixture</title></head><body><main><h1>Checkout</h1><button id="buy" onclick="fetch(\'/api/orders\',{method:\'POST\'}).then(()=>document.querySelector(\'#receipt\').textContent=\'Order created\')">Buy</button><p id="receipt" role="status">Ready</p></main></body></html>',
    );
  } else if (request.url === "/api/orders" && request.method === "POST") {
    if (mode !== "async")
      orders.set(session, {
        total: mode === "wrong-amount" ? 43 : 42,
        owner: "buyer",
      });
    response.setHeader("content-type", "application/json");
    response.end("{}");
  } else if (request.url === "/api/orders/latest") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ order: orders.get(session) || null }));
  } else if (request.url === "/api/admin") {
    response.statusCode = mode === "permission" ? 200 : 403;
    response.end("{}");
  } else {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const preview = "http://127.0.0.1:" + (server.address() as any).port;
const database = await createPGliteDatabase(),
  config = {
    origin: "https://e2e.fixture",
    secret: "enterprise-e2e-only-secret-at-least-32-characters",
    production: false,
    ledgerAllowedOrigins: ["https://ledger.fixture"],
    sendSignInLink: async ({ url }: { url: string }) => {
      link = url;
    },
  };
await migrateDatabase(database, config);
const r: Runtime = {
  database,
  config,
  auth: createAuth(database, config),
  defer: (w) => tasks.push(w),
  repositoryFetch: async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/user")
      return Response.json({ id: 42, login: "fixture-admin" });
    if (path.endsWith("/permission"))
      return Response.json({ permission: "admin", user: { id: 42 } });
    if (path.endsWith("/pulls/42"))
      return Response.json({
        state: "open",
        head: { sha: revision, ref: "fixture" },
        labels: [],
        draft: false,
      });
    if (path.includes("/git/ref/"))
      return Response.json({
        ref: "refs/heads/main",
        object: { type: "commit", sha: revision },
      });
    if (path.includes("/commits/")) return Response.json({ sha: revision });
    return Response.json({
      id: 77,
      full_name: "fixture/operational",
      private: false,
      default_branch: "main",
      permissions: { pull: true },
    });
  },
};
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  return handleRequest(
    new Request(config.origin + path, {
      method,
      headers: {
        origin: config.origin,
        "content-type": "application/json",
        "x-forwarded-for": "192.0.2.240",
        ...(token ? { authorization: "Bearer " + token } : { cookie }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    r,
  );
}
async function checked(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  const response = await api(path, method, body, token);
  assert.ok(response.status < 400, await response.clone().text());
  return response;
}
async function drain() {
  while (tasks.length) await tasks.shift()!();
}
const observations: any[] = [];
const started = performance.now();
try {
  await checked("/api/auth/sign-in/magic-link", "POST", {
    email: "owner@e2e.invalid",
    name: "E2E owner",
  });
  const u = new URL(link),
    v = await checked(u.pathname + u.search);
  cookie = await secureSession(r, cookieJar("", v));
  const p = (
      await (
        await checked("/api/projects", "POST", {
          name: "Controlled operational fixture",
          repository: "fixture/operational",
        })
      ).json()
    ).project,
    root = "/api/projects/" + p.id,
    token = (await (await checked(root + "/token", "POST", {})).json()).token;
  const runnerId = "e".repeat(64);
  await checked(
    "/api/agent/heartbeat",
    "POST",
    {
      models: [
        {
          id: "deterministic-fixture",
          name: "No inference",
          contextLength: 8192,
          tools: true,
          vision: false,
        },
      ],
      runner: {
        id: runnerId,
        ready: true,
        executeJobs: true,
        missing: [],
        browsers: ["chromium"],
        backends: ["local"],
        maxPages: 4,
        maxCostUsd: 1,
        maxCallsPerRun: 4,
        platforms: ["web"],
        qualityPlans: true,
        apiAssertions: true,
      },
    },
    token,
  );
  const assertions = [
    { id: "click", action: "click", selector: "#buy" },
    {
      id: "saved",
      action: "expectText",
      selector: "#receipt",
      text: "Order created",
      exact: true,
    },
    {
      id: "amount",
      action: "expectApi",
      path: "/api/orders/latest",
      status: 200,
      jsonPointer: "/order/total",
      expectedValue: 42,
    },
    {
      id: "owner",
      action: "expectApi",
      path: "/api/orders/latest",
      status: 200,
      jsonPointer: "/order/owner",
      expectedValue: "buyer",
    },
    { id: "permissions", action: "expectApi", path: "/api/admin", status: 403 },
  ];
  await checked(root, "PATCH", {
    settings: {
      backend: "local",
      model: "deterministic-fixture",
      roles: ["planner"],
      roleModels: {},
      maxCostUsd: 0,
      maxCallsPerRun: 4,
      allowImages: false,
    },
    testingProfile: {
      previewUrlTemplate: preview,
      allowMutations: true,
      goals: {
        schemaVersion: 1,
        goals: [
          {
            id: "checkout",
            name: "Checkout order integrity",
            start: "/",
            requirement: "Correct persisted amount/owner and viewer denial.",
            inputs: {},
            assertions: assertions.filter((a) => a.action !== "click"),
          },
        ],
      },
    },
  });
  await checked(root + "/quality-policy", "PATCH", {
    ...policyDefaults,
    automaticTriage: true,
    requirePlanForRelease: false,
    allowEvidenceUploads: true,
  });
  await checked(root + "/requirements", "POST", {
    title: "Order integrity and permissions",
    acceptance:
      "A created order stores total 42 for buyer; a viewer is denied administration.",
    risk: "critical",
    category: "api",
    checkIds: [],
    goalIds: ["checkout"],
    active: true,
    expectedVersion: 0,
  });
  await checked(root + "/repository-connection", "POST", {
    token: "github_pat_fixture-only-token-".repeat(3),
    consent: true,
  });
  const secret = (
    await (await checked(root + "/automation/secret", "POST", {})).json()
  ).secret;
  await checked(root + "/automation", "PATCH", {
    ...automationDefaults,
    enabled: true,
    maxNewJobsPerDay: 20,
  });
  const remote = randomUUID(),
    stored = new Map<string, unknown>();
  let javaAvailable = false;
  r.ledgerFetch = async (url, opts) => {
    if (String(url).endsWith("/project"))
      return Response.json({
        projectId: remote,
        repository: p.repository,
        capabilities: ["assessment-archive-v1"],
      });
    if (!javaAvailable) throw Error("Fixture archive outage");
    if (opts?.method === "PUT")
      stored.set(String(url), JSON.parse(String(opts.body)));
    const parts = new URL(String(url)).pathname.split("/");
    return Response.json({
      projectId: remote,
      recordId: parts.at(-2),
      payloadDigest: parts.at(-1),
      archived: true,
    });
  };
  await connectLedger(
    r,
    p.id,
    {
      origin: "https://ledger.fixture",
      token: "psl_" + "x".repeat(43),
      approveAssessmentTransfer: true,
    },
    "Fixture owner",
  );
  const poll = async (deliveryId: string) => {
    const body = JSON.stringify({ deliveryId });
    const response = await handleRequest(
      new Request(config.origin + "/api/automation/" + p.id + "/result", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256":
            "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
        },
        body,
      }),
      r,
    );
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  for (const scenario of cases) {
    mode = scenario.id;
    orders.clear();
    await writeFile(join(product, "mode.json"), JSON.stringify({ mode }));
    git(["add", "."]);
    git(["commit", "-qm", mode]);
    revision = git(["rev-parse", "HEAD"]);
    const delivery = randomUUID(),
      body = JSON.stringify({
        repository: { full_name: p.repository, id: 77 },
        action: "synchronize",
        number: 42,
        sender: { login: "fixture-author" },
      }),
      headers = {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": delivery,
        "x-hub-signature-256":
          "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
      };
    for (let i = 0; i < 2; i++) {
      const response = await handleRequest(
        new Request(config.origin + "/api/automation/" + p.id + "/github", {
          method: "POST",
          headers,
          body,
        }),
        r,
      );
      assert.equal(response.status, 202);
    }
    await drain();
    const lease = await (
      await checked("/api/agent/jobs/claim", "POST", { runnerId }, token)
    ).json();
    assert.ok(
      lease.job,
      JSON.stringify(await (await checked(root + "/automation")).json()),
    );
    const job = lease.job;
    if (mode === "worker-interrupted") {
      await database.query(
        "UPDATE qa_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
        [job.id],
      );
      await recoverExecutions(r);
      const result = await poll(delivery);
      assert.equal(result.canProceed, false);
      assert.equal(result.job.status, "blocked");
      observations.push({
        case: mode,
        expected: scenario.expected,
        actual: "blocked",
        infrastructure: true,
      });
      continue;
    }
    const checks: any[] = [],
      captures: any[] = [];
    for (const prefix of ["goal-", "replay-"]) {
      const checkId = prefix + "checkout",
        audit = await runWebAudit({
          suite: {
            targetEnvironment: "preview",
            url: preview,
            pages: ["/"],
            browsers: ["chromium"],
            allowMutations: true,
            viewports: [{ name: "desktop", width: 1280, height: 900 }],
            journeys: [
              {
                name: "Checkout resulting data and permissions",
                start: "/",
                steps: assertions,
              },
            ],
          },
          metadata: { repository: p.repository, prNumber: 42, revision },
          checkId,
          outputDir: join(output, mode, prefix),
        });
      if (audit.screenshots[0])
        captures.push({
          checkId,
          screenshot: audit.screenshots[0],
          directory: join(output, mode, prefix),
        });
      checks.push({
        id: checkId,
        name: "Checkout resulting state",
        method: "automated",
        required: true,
        status: audit.result.status,
        details: audit.result.details,
      });
    }
    const recordId = createHash("sha256")
        .update("portal:" + job.id + ":" + p.repository + ":" + revision)
        .digest("hex"),
      report = {
        schemaVersion: 1,
        recordId,
        qualityPlanDigest: job.qualityPlan.digest,
        repository: p.repository,
        pr: { number: 42, title: "Controlled checkout fixture" },
        revision,
        phase: "completed",
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        checks,
        findings: [],
        ai: {
          backend: "local",
          model: "deterministic-fixture",
          calls: 0,
          costUsd: 0,
          costIsEstimate: false,
        },
        limitations: [
          "Real local Chromium deterministic assertions. GitHub/Java transports are fixtures. AI diagnosis not evaluated.",
        ],
      };
    await checked("/api/agent/runs/" + recordId, "PUT", report, token);
    const evidenceIds: string[] = [];
    for (const capture of captures) {
      const bytes = await readFile(
          join(capture.directory, capture.screenshot.path),
        ),
        evidenceId = randomUUID(),
        meta = {
          id: evidenceId,
          checkId: capture.checkId,
          kind: "screenshot",
          name: "Synthetic checkout screenshot",
          mime: "image/png",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
          summary: "Controlled fixture pixels; no real user information.",
          redacted: true,
        };
      const uploaded = await handleRequest(
        new Request(
          config.origin +
            "/api/agent/runs/" +
            recordId +
            "/evidence/" +
            evidenceId,
          {
            method: "PUT",
            headers: {
              authorization: "Bearer " + token,
              "content-type": "image/png",
              "x-patchsentry-evidence": Buffer.from(
                JSON.stringify(meta),
              ).toString("base64url"),
            },
            body: bytes,
          },
        ),
        r,
      );
      assert.equal(uploaded.status, 200, await uploaded.clone().text());
      const downloaded = await checked(root + "/evidence/" + evidenceId);
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(await downloaded.arrayBuffer()))
          .digest("hex"),
        meta.sha256,
      );
      evidenceIds.push(evidenceId);
    }
    await checked(
      "/api/agent/jobs/" + job.id + "/complete",
      "POST",
      {
        runnerId,
        leaseToken: lease.leaseToken,
        status: "completed",
        recordId,
        message: "Controlled browser execution finished",
      },
      token,
    );
    const result = await poll(delivery),
      actual = result.assessmentPassed
        ? "passed"
        : checks.some((c) => c.status === "failed")
          ? "failed"
          : "blocked";
    assert.equal(
      actual,
      scenario.expected,
      JSON.stringify({ mode, checks, result }),
    );
    assert.equal(
      result.canProceed,
      false,
      "Controlled fixture stays advisory.",
    );
    await deliverLedger(r, p.id);
    javaAvailable = true;
    await deliverLedger(r, p.id);
    await reconcileLedger(r, p.id);
    assert.ok(stored.size > 0);
    javaAvailable = false;
    if (mode === "healthy") {
      await database.query(
        "UPDATE qa_runs SET payload=jsonb_set(payload,'{completedAt}',to_jsonb($3::text)) WHERE project_id=$1 AND record_id=$2",
        [p.id, recordId, new Date(Date.now() - 7200000).toISOString()],
      );
      const stale = await poll(delivery);
      assert.equal(stale.canProceed, false);
      assert.ok(stale.reasons.some((v: string) => v.includes("one hour")));
    }
    let history = await (
      await checked(root + "/ledger/history?recordId=" + recordId)
    ).json();
    assert.ok(history.events.length);
    let pages = 1,
      historyEvents = history.events.length;
    while (history.nextBefore) {
      assert.ok(pages < 100);
      history = await (
        await checked(
          root +
            "/ledger/history?recordId=" +
            recordId +
            "&before=" +
            history.nextBefore,
        )
      ).json();
      historyEvents += history.events.length;
      pages++;
    }
    observations.push({
      case: mode,
      expected: scenario.expected,
      actual,
      recordId,
      checks: checks.length,
      evidenceFiles: evidenceIds.length,
      historyPages: pages,
      historyEvents,
      javaAcknowledged: true,
    });
    assert.equal(
      git(["status", "--porcelain"]),
      "",
      "Source remains unchanged during QA.",
    );
  }
  const other = (
    await (
      await checked("/api/projects", "POST", {
        name: "Other tenant fixture",
        repository: "fixture/other",
      })
    ).json()
  ).project;
  assert.equal(
    (
      await api(
        "/api/projects/" +
          other.id +
          "/ledger/history?recordId=" +
          observations[0].recordId,
      )
    ).status,
    404,
  );
  const chain = await verifyLedger(r, p.id);
  assert.equal(chain.valid, true);
  const bugs = (await (await checked(root + "/bugs")).json()).bugs;
  assert.ok(
    bugs.some(
      (b: any) => b.payload.origin === "automatic deterministic triage",
    ),
  );
  const receipts = (
    await database.query<{ id: string }>(
      "SELECT id FROM qa_assessment_ledger WHERE project_id=$1 AND event_type='assessment-context'",
      [p.id],
    )
  ).rows;
  assert.ok(receipts.length >= 5);
  assert.ok(
    (await ledgerPayload(r, p.id, receipts[0].id)).context.testingProfile,
  );
  const summary = {
    scope:
      "Controlled application; real Chromium UI/API/data assertions with fixture GitHub/Java transports. Not a real customer qualification.",
    labelsRegisteredBeforeExecution: true,
    observations,
    matched: observations.filter((v) => v.expected === v.actual).length,
    distinctSeededProductDefects: 3,
    identityControls: 1,
    infrastructureFailures: 1,
    duplicateDeliveriesDeduplicated: true,
    crossProjectHistoryDenied: true,
    automaticDefectReports: bugs.length,
    ledgerChainValid: chain.valid,
    frozenContexts: receipts.length,
    modelCalls: 0,
    aiDiagnosisEvaluated: false,
    staffingImpact: "Not measured; no manual-workflow baseline.",
    runtimeMs: Math.round(performance.now() - started),
  };
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
} finally {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  await database.end();
}
