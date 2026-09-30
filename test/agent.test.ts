import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { RunInputSchema, computeScore } from "../src/lib/contracts";
import {
  MAX_PAYLOAD_BYTES,
  PortalClient,
  sanitizeText,
  serializeRun,
  serializeState,
  validatePortalUrl,
  validateRemoteConfig,
  mergeModelSettings,
  localInventory,
  loadBot,
  syncOnce,
  parseArgs,
} from "../scripts/agent.mjs";

const revision = "a".repeat(40);
const token = `pst_${"s".repeat(43)}`;
const project = {
  schemaVersion: 1,
  projectId: "project-fixture",
  repository: "owner/product",
  settings: {
    backend: "openrouter",
    model: "example/reviewer",
    roles: ["planner", "security"],
    roleModels: {},
    maxCostUsd: 2,
    maxCallsPerRun: 20,
    allowImages: false,
  },
};

function run(overrides: Record<string, unknown> = {}): any {
  const latest = {
    revision,
    roles: [{ role: "triage", model: "example/reviewer" }],
    findings: [],
    cost: 0.04,
    costIsEstimate: false,
    budget: { calls: 3 },
    limitations: [],
  };
  return {
    key: "logical-run",
    revision,
    repository: "owner/product",
    pr: { number: 4, title: "Improve checkout" },
    attempt: 1,
    createdAt: "2026-09-30T12:00:00.000Z",
    completedAt: "2026-09-30T12:01:00.000Z",
    phase: "completed",
    plan: {
      checks: [
        {
          id: "runner-tests",
          name: "Tests",
          method: "automated",
          required: true,
        },
      ],
    },
    results: [
      {
        checkId: "runner-tests",
        revision,
        status: "passed",
        details: "Do not upload raw logs",
      },
    ],
    decisions: [],
    ai: { latest },
    ...overrides,
  };
}

async function fixture(
  t: any,
  initialState: any = { version: 1, runs: { one: run() } },
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "patchsentry-agent-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const botDir = path.join(root, "bot");
  await fs.mkdir(path.join(botDir, ".qa-local"), { recursive: true });
  await fs.mkdir(path.join(botDir, "src/ai"), { recursive: true });
  await fs.writeFile(
    path.join(botDir, "package.json"),
    JSON.stringify({ name: "qa-signoff-bot" }),
  );
  const ai = {
    enabled: true,
    backend: "openrouter",
    model: "example/original",
    roleModels: {},
    roles: ["planner", "security"],
    maxCostUsd: 1,
    maxCallsPerRun: 5,
    maxInputChars: 10000,
    allowImages: false,
    requireReview: true,
    excludePaths: ["private/**"],
    local: {
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [
        { id: "qwen3:8b", contextLength: 8192, tools: true, vision: false },
      ],
    },
  };
  const config = {
    enabled: false,
    ai,
    runners: [{ id: "trusted", command: "immutable" }],
  };
  await fs.writeFile(
    path.join(botDir, "qa-config.json"),
    JSON.stringify(config),
  );
  await fs.writeFile(
    path.join(botDir, ".qa-local/state.json"),
    JSON.stringify(initialState),
  );
  await fs.writeFile(
    path.join(botDir, "src/ai/settings.js"),
    `module.exports.validateAIConfig = ai => {
    if (ai.model === 'invalid/model') throw new Error('unsafe validator detail');
    if (ai.backend === 'local' && !ai.local.models.some(p => p.id === ai.model)) throw new Error('Unknown local model');
    return {...ai};
  };\n`,
  );
  return { root, botDir, config, options: { botDir } };
}

test("upload allowlist omits source, logs, screenshots, credentials, quoted code, proposed code, and AI transcripts", () => {
  const input = run();
  input.pr.title = `Fix ${token}`;
  input.request = {
    config: { ai: { backend: "local", apiKey: "never-upload-request-key" } },
  };
  input.report = { markdown: "never-upload-markdown" };
  input.sourceFiles = [{ content: "never-upload-source-file" }];
  input.results[0].evidence = [{ excerpt: "never-upload-log-excerpt" }];
  input.screenshots = [{ data: "never-upload-image" }];
  input.ai.latest.transcript = [{ content: "never-upload-transcript" }];
  input.ai.latest.candidates = [{ source: "never-upload-candidate-code" }];
  input.ai.latest.findings = [
    {
      title: "Checkout issue",
      severity: "high",
      category: "bug",
      file: "src/cart.ts",
      description:
        "Unsafe input. ```js\nnever-upload-fenced-code\n```\n> never-upload-quotation\n    never-upload-indented-code\n`never-upload-inline-code` password=supersecret sk-or-v1-abcdefghijk123456",
      suggestedFix: 'Validate the cart. "never-upload-quoted-source"',
      evidence: [{ quote: "never-upload-evidence-source" }],
      status: "verified",
    },
  ];
  const result = RunInputSchema.parse(serializeRun(input));
  const json = JSON.stringify(result);
  assert.doesNotMatch(
    json,
    /never-upload|supersecret|sk-or-v1-abcdefghijk123456/,
  );
  assert.ok(!json.includes(token));
  assert.equal(result.findings[0].status, "unverified");
  assert.equal(result.ai.backend, "local");
  assert.equal(result.checks[0].status, "passed");
  assert.match(result.limitations[0], /may still contain product information/);
});

test("check outcomes stay revision-bound and cannot be upgraded by an AI verdict or stored score", () => {
  const input = run({ outcome: { status: "passed", score: 100 } });
  input.plan.checks.push(
    { id: "unknown", method: "invented", status: "passed" },
    {
      id: "analysis",
      method: "analysis",
      revision: "b".repeat(40),
      analysisStatus: "passed",
    },
  );
  input.results[0].status = "failed";
  input.ai.latest.status = "completed";
  const result = RunInputSchema.parse(serializeRun(input));
  assert.deepEqual(
    result.checks.map((c) => c.status),
    ["failed", "unsupported", "blocked"],
  );
  assert.equal(computeScore(result).status, "failed");
  assert.equal(computeScore(result).score, 0);
  input.results[0].revision = "b".repeat(40);
  assert.equal(serializeRun(input).checks[0].status, "blocked");
});

test("pending, absent, invalid and duplicate results never count as a pass", () => {
  for (const status of ["pending", "made-up", "awaiting_human", undefined]) {
    const input = run();
    input.results[0].status = status;
    const result = RunInputSchema.parse(serializeRun(input));
    assert.notEqual(result.checks[0].status, "passed");
    assert.equal(computeScore(result).score, 0);
  }
  assert.equal(
    serializeRun(run({ results: [], phase: "queued" })).checks[0].status,
    "pending",
  );
  assert.equal(
    serializeRun(run({ results: [], phase: "running" })).checks[0].status,
    "running",
  );
  const input = run();
  input.results.push({ ...input.results[0] });
  assert.equal(serializeRun(input).checks[0].status, "execution_error");
});

test("human decisions require an exact revision and respect invalidation", () => {
  const input = run({
    plan: { checks: [{ id: "human", method: "human" }] },
    decisions: [
      { checkId: "human", revision: "b".repeat(40), result: "pass" },
      {
        checkId: "human",
        revision,
        result: "pass",
        invalidatedAt: "2026-09-30T11:00:00Z",
      },
    ],
  });
  assert.equal(serializeRun(input).checks[0].status, "awaiting_human");
  input.decisions.push({
    checkId: "human",
    revision,
    result: "fail",
    timestamp: "2026-09-30T12:00:00Z",
  });
  assert.equal(serializeRun(input).checks[0].status, "failed");
});

test("planning security findings survive completion; cumulative usage is counted once and historical backend remains unknown", () => {
  const input = run();
  const finding = {
    title: "Missing authorization",
    severity: "high",
    category: "security",
    description: "Check authorization.",
  };
  input.ai.planning = {
    revision,
    cost: 0.02,
    budget: { calls: 2 },
    findings: [finding],
    roles: [{ model: "example/security" }],
  };
  input.ai.completion = { ...input.ai.latest, findings: [finding] };
  const result = RunInputSchema.parse(serializeRun(input));
  assert.equal(result.ai.costUsd, 0.04);
  assert.equal(result.ai.calls, 3);
  assert.equal(result.ai.backend, "unknown");
  assert.equal(result.findings.length, 1);
  assert.equal(computeScore(result).status, "needs_review");
  assert.match(result.ai.model, /example\/security/);
});

test("serializer enforces identity, unique checks, full denominator and bounded payloads", () => {
  assert.throws(() => serializeRun(run({ revision: "main" })), /identity/);
  assert.throws(
    () =>
      serializeRun(
        run({
          plan: {
            checks: Array.from({ length: 201 }, (_, i) => ({ id: String(i) })),
          },
        }),
      ),
    /200 checks/,
  );
  const duplicate = run();
  duplicate.plan.checks.push({ ...duplicate.plan.checks[0] });
  assert.throws(() => serializeRun(duplicate), /duplicated/);
  const input = run();
  input.ai.latest.findings = Array.from({ length: 101 }, (_, i) => ({
    title: `Finding ${i}`,
    severity: i === 100 ? "critical" : "low",
    description: "x".repeat(10000),
    suggestedFix: "y".repeat(10000),
  }));
  const result = RunInputSchema.parse(serializeRun(input));
  assert.equal(result.findings.length, 100);
  assert.equal(result.findings[0].severity, "critical");
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= MAX_PAYLOAD_BYTES);
  assert.match(result.limitations.join(" "), /shortened/);
  assert.equal(result.checks.length, 1);
});

test("stable record IDs distinguish execution attempts and preserve history without leaking other projects", () => {
  const first = run({ actionsRunId: 123, actionsAttempt: 1 });
  const second = run({
    actionsRunId: 123,
    actionsAttempt: 2,
    completionHistory: [{ snapshot: first }],
  });
  const state = {
    runs: {
      current: second,
      unrelated: run({ repository: "another/product" }),
      invalid: run({ key: "" }),
    },
  };
  const one = serializeState(state, "owner/product");
  const two = serializeState(state, "OWNER/product");
  assert.equal(one.records.length, 2);
  assert.equal(one.skipped, 1);
  assert.notEqual(one.records[0].recordId, one.records[1].recordId);
  assert.deepEqual(one.records, two.records);
  assert.equal(serializeRun(second).recordId, one.records[1].recordId);
});

test("portal URL permits HTTPS origins and requires an explicit literal loopback development exception", () => {
  assert.equal(
    validatePortalUrl("https://portal.example/"),
    "https://portal.example",
  );
  for (const value of [
    "http://portal.example",
    "http://127.0.0.1:3000",
    "https://user:pass@portal.example",
    "https://portal.example/api",
    "https://portal.example/?token=secret",
    "https://portal.example/#secret",
    "file:///tmp/report",
  ]) {
    assert.throws(() => validatePortalUrl(value));
  }
  for (const value of [
    "http://localhost:3000",
    "http://127.1:3000",
    "http://2130706433:3000",
    "http://evil.example:3000",
  ]) {
    assert.throws(() => validatePortalUrl(value, { allowHttpLoopback: true }));
  }
  assert.equal(
    validatePortalUrl("http://127.0.0.1:3000", { allowHttpLoopback: true }),
    "http://127.0.0.1:3000",
  );
  assert.equal(
    validatePortalUrl("http://[::1]:3000", { allowHttpLoopback: true }),
    "http://[::1]:3000",
  );
});

test("HTTP requests pin the origin, prohibit redirects, and never surface tokens or response bodies in failures", async () => {
  const calls: any[] = [];
  const client = new PortalClient({
    url: "https://portal.example",
    token,
    fetchImpl: async (url: any, options: any) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ secret: token }), { status: 401 });
    },
  });
  await assert.rejects(client.request("GET", "/api/agent/config"), (error) => {
    assert.equal((error as Error).message, "Portal request failed (HTTP 401).");
    assert.ok(!(error as Error).message.includes(token));
    return true;
  });
  assert.equal(calls[0].url, "https://portal.example/api/agent/config");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.ok(!JSON.stringify(client).includes(token));
  await assert.rejects(
    client.request("PUT", "//other.example/leak", {}),
    /Unsupported/,
  );
  assert.equal(calls.length, 1);
  const broken = new PortalClient({
    url: "https://portal.example",
    token,
    fetchImpl: async () => {
      throw new Error(token);
    },
  });
  await assert.rejects(
    broken.request("GET", "/api/agent/config"),
    /check connectivity/,
  );
});

test("HTTP response and request bodies have enforced size limits even without content-length", async () => {
  let calls = 0;
  const client = new PortalClient({
    url: "https://portal.example",
    token,
    fetchImpl: async () => {
      calls++;
      return new Response("x".repeat(MAX_PAYLOAD_BYTES + 1));
    },
  });
  await assert.rejects(
    client.request("GET", "/api/agent/config"),
    /size limit/,
  );
  await assert.rejects(
    client.request("POST", "/api/agent/heartbeat", {
      text: "x".repeat(MAX_PAYLOAD_BYTES),
    }),
    /size limit/,
  );
  assert.equal(calls, 1);
});

test("remote settings cannot change endpoints, keys, source filters, local budgets or activation without local enrollment", () => {
  const local = {
    enabled: false,
    ai: {
      enabled: false,
      backend: "local",
      model: "qwen3:8b",
      roles: ["planner"],
      roleModels: {},
      local: { baseUrl: "http://127.0.0.1:11434/v1", models: [] },
      provider: { data_collection: "deny" },
      maxCostUsd: 0.4,
      maxCallsPerRun: 4,
      allowImages: false,
      excludePaths: ["private/**"],
      requireReview: true,
    },
  };
  const validator = (value: any) => value;
  assert.throws(
    () => mergeModelSettings(local, project, { validateAIConfig: validator }),
    /not enrolled/,
  );
  const updated = mergeModelSettings(local, project, {
    validateAIConfig: validator,
    allowedBackends: ["local", "openrouter"],
  });
  assert.equal(updated.ai.backend, "openrouter");
  assert.equal(updated.ai.model, "example/reviewer");
  assert.equal(updated.ai.maxCostUsd, 0.4);
  assert.equal(updated.ai.maxCallsPerRun, 4);
  assert.equal(updated.ai.enabled, false);
  assert.deepEqual(updated.ai.excludePaths, ["private/**"]);
  assert.deepEqual(updated.ai.provider, { data_collection: "deny" });
  assert.equal(updated.ai.local.baseUrl, "http://127.0.0.1:11434/v1");
  assert.throws(
    () =>
      validateRemoteConfig({
        ...project,
        settings: {
          ...project.settings,
          local: { baseUrl: "https://attacker.test/v1" },
        },
      }),
    /invalid/,
  );
  assert.throws(
    () =>
      mergeModelSettings(
        local,
        { ...project, settings: { ...project.settings, allowImages: true } },
        { validateAIConfig: validator, allowedBackends: ["openrouter"] },
      ),
    /screenshot sharing/,
  );
  assert.throws(
    () =>
      mergeModelSettings(local, project, {
        validateAIConfig: () => {
          throw new Error("secret");
        },
      }),
    /Local bot AI settings are invalid/,
  );
});

test("local inventory uploads only declared model metadata, with no server endpoint or key", () => {
  const models = localInventory({
    ai: {
      local: {
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: token,
        models: [
          {
            id: "qwen3:8b",
            contextLength: 8192,
            tools: true,
            vision: false,
            maxCompletionTokens: 2000,
            secret: token,
          },
          { id: "qwen3:8b", contextLength: 8192, tools: true, vision: false },
          { id: "invalid" },
        ],
      },
    },
  });
  assert.deepEqual(models, [
    {
      id: "qwen3:8b",
      name: "qwen3:8b",
      contextLength: 8192,
      tools: true,
      vision: false,
    },
  ]);
  assert.ok(!JSON.stringify(models).includes(token));
});

test("sync uploads real summaries and heartbeats, deduplicates unchanged watch data, and writes nothing by default", async (t) => {
  const { botDir, config, options } = await fixture(t);
  const writes: any[] = [];
  const client = {
    request: async (method: string, endpoint: string, body?: any) => {
      writes.push({ method, endpoint, body });
      return method === "GET" ? project : { ok: true };
    },
  };
  const receipts = new Map();
  const first = await syncOnce({ options, client, receipts });
  assert.equal(first.uploaded, 1);
  assert.equal(first.settingsApplied, false);
  assert.equal(first.localModels, 1);
  assert.equal(writes[1].endpoint, "/api/agent/heartbeat");
  RunInputSchema.parse(writes[2].body);
  const second = await syncOnce({ options, client, receipts });
  assert.equal(second.uploaded, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(writes.filter((item) => item.method === "PUT").length, 1);
  const state = JSON.parse(
    await fs.readFile(path.join(botDir, ".qa-local/state.json"), "utf8"),
  );
  state.runs.one.results[0].status = "failed";
  await fs.writeFile(
    path.join(botDir, ".qa-local/state.json"),
    JSON.stringify(state),
  );
  const third = await syncOnce({ options, client, receipts });
  assert.equal(third.uploaded, 1);
  assert.equal(writes.at(-1).body.checks[0].status, "failed");
  assert.equal(writes[2].body.recordId, writes.at(-1).body.recordId);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(botDir, "qa-config.json"), "utf8")),
    config,
  );
  assert.deepEqual((await fs.readdir(botDir)).sort(), [
    ".qa-local",
    "package.json",
    "qa-config.json",
    "src",
  ]);
});

test("only explicit apply writes the trusted bot configuration after its actual validator accepts the model", async (t) => {
  const { botDir, config, options } = await fixture(t);
  const client = {
    request: async (method: string) =>
      method === "GET" ? project : { ok: true },
  };
  const beforeState = await fs.readFile(
    path.join(botDir, ".qa-local/state.json"),
    "utf8",
  );
  const result = await syncOnce({
    options: { ...options, applyModelSettings: true },
    client,
  });
  assert.equal(result.settingsApplied, true);
  const updated = JSON.parse(
    await fs.readFile(path.join(botDir, "qa-config.json"), "utf8"),
  );
  assert.equal(updated.ai.model, "example/reviewer");
  assert.equal(updated.ai.maxCostUsd, 1);
  assert.equal(updated.ai.maxCallsPerRun, 5);
  assert.deepEqual(updated.runners, config.runners);
  assert.equal(updated.enabled, false);
  assert.equal(
    await fs.readFile(path.join(botDir, ".qa-local/state.json"), "utf8"),
    beforeState,
  );
  const invalid = {
    request: async () => ({
      ...project,
      settings: { ...project.settings, model: "invalid/model" },
    }),
  };
  await assert.rejects(
    syncOnce({
      options: { ...options, applyModelSettings: true },
      client: invalid,
    }),
    /incompatible/,
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(botDir, "qa-config.json"), "utf8")),
    updated,
  );
});

test("dry-run performs no network call, model validation code execution, or local write; absent state is empty", async (t) => {
  const { botDir, options } = await fixture(t);
  await fs.writeFile(
    path.join(botDir, "src/ai/settings.js"),
    'throw new Error("must not execute in dry-run");',
  );
  const before = await fs.readFile(path.join(botDir, "qa-config.json"), "utf8");
  const result = await syncOnce({
    options: { ...options, dryRun: true, applyModelSettings: true },
    env: {},
    client: { request: async () => assert.fail("network called") },
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.runs, 1);
  assert.equal(
    await fs.readFile(path.join(botDir, "qa-config.json"), "utf8"),
    before,
  );
  await fs.unlink(path.join(botDir, ".qa-local/state.json"));
  const missing = await syncOnce({
    options: { ...options, dryRun: true },
    env: {},
  });
  assert.equal(missing.runs, 0);
});

test("failed uploads are not acknowledged or deduplicated on retry", async (t) => {
  const { options } = await fixture(t);
  let attempts = 0;
  const client = {
    request: async (method: string) => {
      if (method === "GET") return project;
      if (method === "PUT" && ++attempts === 1)
        throw new Error("fixture upload failed");
      return { ok: true };
    },
  };
  const receipts = new Map();
  await assert.rejects(
    syncOnce({ options, client, receipts }),
    /fixture upload failed/,
  );
  assert.equal(receipts.size, 0);
  assert.equal((await syncOnce({ options, client, receipts })).uploaded, 1);
  assert.equal(attempts, 2);
});

test("config and state cannot escape the bot through explicit paths or symlinks; generic product directories are rejected", async (t) => {
  const { root, botDir, options } = await fixture(t);
  const product = path.join(root, "product");
  await fs.mkdir(product);
  await fs.writeFile(path.join(product, "package.json"), '{"name":"product"}');
  await fs.writeFile(path.join(product, "config.json"), "{}");
  await fs.symlink(product, path.join(botDir, "product-alias"));
  for (const config of [
    "../product/config.json",
    "product-alias/config.json",
    path.join(product, "config.json"),
  ]) {
    await assert.rejects(loadBot({ ...options, config }), /inside|outside/);
  }
  await assert.rejects(
    loadBot({ ...options, state: "../product/missing.json" }),
    /inside/,
  );
  await assert.rejects(loadBot({ botDir: product }), /not a product checkout/);
  assert.equal(
    await fs.readFile(path.join(product, "config.json"), "utf8"),
    "{}",
  );
});

test("CLI error output excludes environment credentials and unknown option values", async () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/agent.mjs", `--${token}`],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, QA_PORTAL_TOKEN: token },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.ok(!(result.stdout + result.stderr).includes(token));
  assert.match(result.stderr, /configuration is invalid/);
  assert.throws(() => parseArgs(["--watch", "--interval", "1"]), /30 to 3600/);
  assert.throws(
    () => parseArgs(["--dry-run", "--watch"]),
    /single offline preview/,
  );
  assert.deepEqual(
    parseArgs([
      "--bot-dir",
      "/trusted/bot",
      "--allow-backends",
      "openrouter,local",
    ]).allowedBackends,
    ["openrouter", "local"],
  );
  assert.equal(
    sanitizeText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"),
    "[redacted credential]",
  );
});

test(
  "the real authenticated backend accepts agent summaries and applies website local-model choices end to end",
  { timeout: 30000 },
  async (t) => {
    const [
      { createPGliteDatabase },
      { createAuth, migrateDatabase },
      { handleRequest },
    ] = await Promise.all([
      import("../src/lib/server/database"),
      import("../src/lib/server/auth"),
      import("../src/lib/server/api"),
    ]);
    const { botDir, options } = await fixture(t);
    const database = await createPGliteDatabase();
    t.after(() => database.end());
    const config = {
      origin: "https://portal.example",
      secret: "agent-integration-test-only-secret-at-least-32-characters",
      production: false,
    };
    await migrateDatabase(database, config);
    const runtime = { database, config, auth: createAuth(database, config) };
    const call = (
      endpoint: string,
      method: string,
      body?: unknown,
      cookie?: string,
    ) =>
      handleRequest(
        new Request(config.origin + endpoint, {
          method,
          headers: {
            origin: config.origin,
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        runtime,
      );
    const signup = await call("/api/auth/sign-up/email", "POST", {
      name: "Agent owner",
      email: "agent-owner@example.test",
      password: "Agent-fixture-only-password-1234",
    });
    assert.equal(signup.status, 200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const create = await call(
      "/api/projects",
      "POST",
      { name: "Agent project", repository: "owner/product" },
      cookie,
    );
    assert.equal(create.status, 201);
    const projectId = (await create.json()).project.id;
    const issued = await call(
      `/api/projects/${projectId}/token`,
      "POST",
      undefined,
      cookie,
    );
    assert.equal(issued.status, 200);
    const agentToken = (await issued.json()).token;
    const requests: string[] = [];
    const portal = new PortalClient({
      url: config.origin,
      token: agentToken,
      fetchImpl: async (url: any, init: any) => {
        requests.push(url);
        return handleRequest(new Request(url, init), runtime);
      },
    });
    assert.equal((await syncOnce({ options, client: portal })).uploaded, 1);
    const settings = {
      ...project.settings,
      backend: "local",
      model: "qwen3:8b",
    };
    const selected = await call(
      `/api/projects/${projectId}`,
      "PATCH",
      { settings },
      cookie,
    );
    assert.equal(
      selected.status,
      200,
      JSON.stringify(await selected.clone().json()),
    );
    assert.equal(
      (
        await syncOnce({
          options: {
            ...options,
            applyModelSettings: true,
            allowedBackends: ["openrouter", "local"],
          },
          client: portal,
        })
      ).settingsApplied,
      true,
    );
    const saved = JSON.parse(
      await fs.readFile(path.join(botDir, "qa-config.json"), "utf8"),
    );
    assert.equal(saved.ai.backend, "local");
    assert.equal(saved.ai.model, "qwen3:8b");
    assert.equal(saved.ai.maxCostUsd, 1);
    assert.equal(saved.ai.maxCallsPerRun, 5);
    const stateFile = path.join(botDir, ".qa-local/state.json");
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    state.runs.one.results[0].status = "failed";
    await fs.writeFile(stateFile, JSON.stringify(state));
    await syncOnce({ options, client: portal });
    const reports = await database.query<{
      payload: {
        checks: { status: string }[];
        score: { status: string; score: number };
      };
    }>("SELECT payload FROM qa_runs WHERE project_id = $1", [projectId]);
    assert.equal(reports.rows.length, 1);
    assert.equal(reports.rows[0].payload.checks[0].status, "failed");
    assert.equal(reports.rows[0].payload.score.status, "failed");
    assert.equal(reports.rows[0].payload.score.score, 0);
    assert.ok(
      requests.every((url) => url.startsWith(config.origin + "/api/agent/")),
    );
  },
);
