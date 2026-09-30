import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPGliteDatabase,
  createDatabase,
} from "../src/lib/server/database";
import {
  authConfig,
  createAuth,
  migrateDatabase,
} from "../src/lib/server/auth";
import { handleRequest } from "../src/lib/server/api";
import type { Runtime } from "../src/lib/server/runtime";
import { settingsDefaults, type RunInput } from "../src/lib/contracts";

const config = {
  secret: "local-test-only-authentication-secret-64-characters-for-tests",
  origin: "http://localhost:3000",
  production: false,
};
let runtime: Runtime;
let directory: string;
let alice = "";
let bob = "";
let aliceId = "";
let projectId = "";
let token = "";

function request(
  path: string,
  method = "GET",
  body?: unknown,
  options: {
    cookie?: string;
    token?: string;
    origin?: string | null;
    contentType?: string;
  } = {},
) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.token) headers.set("authorization", "Bearer " + options.token);
  if (method !== "GET" && options.origin !== null)
    headers.set("origin", options.origin ?? config.origin);
  headers.set("x-forwarded-for", "127.0.0.1");
  if (body !== undefined)
    headers.set("content-type", options.contentType ?? "application/json");
  return new Request(config.origin + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  options: Parameters<typeof request>[3] = {},
) {
  return handleRequest(request(path, method, body, options), runtime);
}
async function signup(name: string) {
  const response = await call("/api/auth/sign-up/email", "POST", {
    name,
    email: name.toLowerCase() + "@example.test",
    password: "Correct-horse-local-test-password-42",
  });
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookies.includes("session_token"));
  return { cookie: cookies, data: await response.json() };
}
function report(overrides: Partial<RunInput> = {}): RunInput {
  return {
    schemaVersion: 1,
    recordId: "a".repeat(64),
    repository: "acme/product",
    pr: { number: 42, title: "Improve checkout" },
    revision: "b".repeat(40),
    createdAt: "2026-09-30T10:00:00.000Z",
    phase: "completed",
    checks: [
      {
        id: "unit",
        name: "Unit tests",
        method: "automated",
        required: true,
        status: "passed",
      },
    ],
    findings: [],
    ai: {
      backend: "local",
      model: "qa:8b",
      costUsd: 0,
      costIsEstimate: false,
      calls: 2,
    },
    limitations: [],
    ...overrides,
  };
}

before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), "patchsentry-backend-"));
    const database = await createPGliteDatabase(
      join(directory, "fresh-parent", "database"),
    );
    await migrateDatabase(database, config);
    runtime = { database, auth: createAuth(database, config), config };
    const first = await signup("Alice");
    alice = first.cookie;
    aliceId = first.data.user.id;
    bob = (await signup("Bob")).cookie;
  },
  { timeout: 30000 },
);
after(async () => {
  if (runtime) await runtime.database.end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("accounts persist as password hashes and sessions identify the correct owner", async () => {
  const response = await call("/api/session", "GET", undefined, {
    cookie: alice,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.configured, true);
  assert.equal(body.user.email, "alice@example.test");
  const stored = await runtime.database.query<{ password: string }>(
    'SELECT password FROM account WHERE "userId" = $1',
    [aliceId],
  );
  assert.ok(stored.rows[0].password);
  assert.ok(!stored.rows[0].password.includes("Correct-horse"));
  assert.equal((await call("/api/projects")).status, 401);
  assert.equal((await call("/api/session")).status, 200);
  assert.equal((await (await call("/api/session")).json()).user, null);
});

test("persistent account storage survives a database and auth instance restart", async () => {
  await runtime.database.end();
  const database = await createPGliteDatabase(
    join(directory, "fresh-parent", "database"),
  );
  runtime = { database, auth: createAuth(database, config), config };
  const response = await call("/api/session", "GET", undefined, {
    cookie: alice,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, aliceId);
});

test("project create/list operations enforce owner isolation and unique repository binding", async () => {
  const create = await call(
    "/api/projects",
    "POST",
    { name: "Product QA", repository: "Acme/Product" },
    { cookie: alice },
  );
  assert.equal(create.status, 201, JSON.stringify(await create.clone().json()));
  const data = await create.json();
  projectId = data.project.id;
  assert.equal(data.project.repository, "acme/product");
  assert.equal(data.project.tokenConfigured, false);
  assert.equal(data.project.owner_id, undefined);
  assert.equal(
    (
      await (
        await call("/api/projects", "GET", undefined, { cookie: alice })
      ).json()
    ).projects.length,
    1,
  );
  assert.deepEqual(
    (
      await (
        await call("/api/projects", "GET", undefined, { cookie: bob })
      ).json()
    ).projects,
    [],
  );
  assert.equal(
    (
      await call("/api/projects/" + projectId, "GET", undefined, {
        cookie: bob,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        "/api/projects",
        "POST",
        { name: "Duplicate", repository: "acme/product" },
        { cookie: alice },
      )
    ).status,
    409,
  );
});

test("cookie-authenticated mutations require exact Origin and strict body schemas", async () => {
  assert.equal(
    (
      await call(
        "/api/projects",
        "POST",
        { name: "Evil", repository: "evil/repo" },
        { cookie: alice, origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/projects",
        "POST",
        { name: "Missing origin", repository: "evil/repo" },
        { cookie: alice, origin: null },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/auth/sign-in/email",
        "POST",
        { email: "alice@example.test", password: "secret" },
        { origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/projects",
        "POST",
        { name: "Injection", repository: "acme/other", ownerId: aliceId },
        { cookie: bob },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/projects",
        "POST",
        { name: "HTML", repository: "acme/other" },
        { cookie: alice, contentType: "text/plain" },
      )
    ).status,
    415,
  );
});

test("project tokens are hashed, tenant scoped, shown once, and invalidated on rotation", async () => {
  assert.equal(
    (
      await call("/api/projects/" + projectId + "/token", "POST", undefined, {
        cookie: bob,
      })
    ).status,
    404,
  );
  let response = await call(
    "/api/projects/" + projectId + "/token",
    "POST",
    undefined,
    { cookie: alice },
  );
  assert.equal(response.status, 200);
  const oldToken = (await response.json()).token;
  assert.match(oldToken, /^pst_[A-Za-z0-9_-]{43}$/);
  const stored = await runtime.database.query<{ agent_token_hash: string }>(
    "SELECT agent_token_hash FROM projects WHERE id = $1",
    [projectId],
  );
  assert.equal(stored.rows[0].agent_token_hash.length, 64);
  assert.notEqual(stored.rows[0].agent_token_hash, oldToken);
  assert.equal(
    (await call("/api/agent/config", "GET", undefined, { token: oldToken }))
      .status,
    200,
  );
  response = await call(
    "/api/projects/" + projectId + "/token",
    "POST",
    undefined,
    { cookie: alice },
  );
  token = (await response.json()).token;
  assert.notEqual(token, oldToken);
  assert.equal(
    (await call("/api/agent/config", "GET", undefined, { token: oldToken }))
      .status,
    401,
  );
  const projectResponse = await call(
    "/api/projects/" + projectId,
    "GET",
    undefined,
    { cookie: alice },
  );
  const serialized = JSON.stringify(await projectResponse.json());
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes("agent_token_hash"));
  assert.equal(
    (await call("/api/agent/config", "GET", undefined, { cookie: alice }))
      .status,
    401,
  );
});

test("local model selection requires a connected agent inventory and declared tools/vision", async () => {
  const settings = { ...settingsDefaults, backend: "local", model: "qa:8b" };
  assert.equal(
    (
      await call(
        "/api/projects/" + projectId,
        "PATCH",
        { settings },
        { cookie: alice },
      )
    ).status,
    400,
  );
  const heartbeat = await call(
    "/api/agent/heartbeat",
    "POST",
    {
      models: [
        {
          id: "qa:8b",
          name: "QA model",
          contextLength: 32768,
          tools: true,
          vision: false,
        },
        {
          id: "vision:8b",
          name: "Vision QA model",
          contextLength: 32768,
          tools: true,
          vision: true,
        },
        {
          id: "no-tools",
          name: "No tools",
          contextLength: 32768,
          tools: false,
          vision: false,
        },
      ],
    },
    { token, origin: null },
  );
  assert.equal(heartbeat.status, 200);
  assert.equal(
    (
      await call(
        "/api/projects/" + projectId,
        "PATCH",
        { settings },
        { cookie: alice },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/api/projects/" + projectId,
        "PATCH",
        { settings: { ...settings, allowImages: true } },
        { cookie: alice },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/projects/" + projectId,
        "PATCH",
        { settings: { ...settings, model: "no-tools" } },
        { cookie: alice },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/projects/" + projectId,
        "PATCH",
        {
          settings: {
            ...settings,
            allowImages: true,
            roleModels: { "ui-ux": "vision:8b" },
          },
        },
        { cookie: alice },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/api/projects/" + projectId,
        "PATCH",
        { settings: { ...settings, apiKey: "must-not-be-stored" } },
        { cookie: alice },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/projects/" + projectId,
        "PATCH",
        { settings: { ...settingsDefaults, model: "openrouter/auto" } },
        { cookie: alice },
      )
    ).status,
    400,
  );
  const configResponse = await call("/api/agent/config", "GET", undefined, {
    token,
  });
  assert.equal((await configResponse.json()).repository, "acme/product");
});

test("OpenRouter selection verifies catalog capability and fails closed when discovery is unavailable", async () => {
  let requests = 0;
  runtime.catalog = async () => {
    requests++;
    return {
      fetchedAt: new Date().toISOString(),
      models: [
        {
          id: "provider/text",
          name: "Text",
          contextLength: 32768,
          tools: true,
          vision: false,
          promptPrice: 1,
          completionPrice: 1,
        },
        {
          id: "provider/vision",
          name: "Vision",
          contextLength: 32768,
          tools: true,
          vision: true,
          promptPrice: 1,
          completionPrice: 1,
        },
        {
          id: "provider/short",
          name: "Short",
          contextLength: 3000,
          tools: true,
          vision: false,
          promptPrice: 0,
          completionPrice: 0,
        },
        {
          id: "provider/no-tools",
          name: "No tools",
          contextLength: 32768,
          tools: false,
          vision: false,
          promptPrice: 0,
          completionPrice: 0,
        },
      ],
    };
  };
  const update = (model: string, extra = {}) =>
    call(
      "/api/projects/" + projectId,
      "PATCH",
      { settings: { ...settingsDefaults, model, ...extra } },
      { cookie: alice },
    );
  assert.equal((await update("provider/text")).status, 200);
  assert.equal(requests, 1);
  assert.equal((await update("provider/absent")).status, 400);
  assert.equal((await update("provider/no-tools")).status, 400);
  assert.equal((await update("provider/short")).status, 400);
  assert.equal(
    (await update("provider/text", { allowImages: true })).status,
    400,
  );
  assert.equal(
    (
      await update("provider/text", {
        allowImages: true,
        roleModels: { "ui-ux": "provider/vision" },
      })
    ).status,
    200,
  );
  runtime.catalog = async () => {
    throw new Error("Do not leak provider detail");
  };
  const unavailable = await update("provider/text");
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes("provider detail"));
  delete runtime.catalog;
});

test("agent reports are bound to project repository, record ID, PR and exact revision", async () => {
  const payload = report();
  assert.equal(
    (
      await call(
        "/api/agent/runs/" + payload.recordId,
        "PUT",
        { ...payload, repository: "other/product" },
        { token },
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/agent/runs/" + "c".repeat(64), "PUT", payload, { token }))
      .status,
    403,
  );
  const saved = await call(
    "/api/agent/runs/" + payload.recordId,
    "PUT",
    payload,
    { token },
  );
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const run = (await saved.json()).run;
  assert.equal(run.score.score, 100);
  assert.equal(run.score.status, "passed");
  assert.equal(
    (
      await call(
        "/api/agent/runs/" + payload.recordId,
        "PUT",
        { ...payload, revision: "d".repeat(40) },
        { token },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/api/projects/" + projectId + "/runs", "GET", undefined, {
        cookie: bob,
      })
    ).status,
    404,
  );
});

test("scores are computed on the server and failed/skipped/unsupported checks cannot become passed", async () => {
  const payload = report({
    checks: [
      {
        id: "pass",
        name: "Passed",
        method: "automated",
        required: true,
        status: "passed",
      },
      {
        id: "fail",
        name: "Failed",
        method: "automated",
        required: true,
        status: "failed",
      },
      {
        id: "skip",
        name: "Skipped",
        method: "automated",
        required: true,
        status: "skipped",
      },
      {
        id: "unsupported",
        name: "Unsupported",
        method: "unsupported",
        required: true,
        status: "passed",
      },
    ],
  });
  assert.equal(
    (
      await call(
        "/api/agent/runs/" + payload.recordId,
        "PUT",
        { ...payload, score: 100 },
        { token },
      )
    ).status,
    400,
  );
  const saved = await call(
    "/api/agent/runs/" + payload.recordId,
    "PUT",
    payload,
    { token },
  );
  const run = (await saved.json()).run;
  assert.equal(run.score.score, 25);
  assert.equal(run.score.status, "failed");
  assert.equal(run.score.blocked, 2);
  const list = await call(
    "/api/projects/" + projectId + "/runs",
    "GET",
    undefined,
    { cookie: alice },
  );
  assert.equal((await list.json()).runs[0].score.score, 25);
});

test("empty results stay unscored and high AI findings remain unverified review requests", async () => {
  let payload = report({ recordId: "e".repeat(64), checks: [] });
  let saved = await call(
    "/api/agent/runs/" + payload.recordId,
    "PUT",
    payload,
    { token },
  );
  assert.equal((await saved.json()).run.score.score, null);
  payload = report({
    recordId: "f".repeat(64),
    findings: [
      {
        title: "Potential bug",
        severity: "high",
        category: "correctness",
        description: "Investigate the stated behavior",
        status: "unverified",
      },
    ],
  });
  saved = await call("/api/agent/runs/" + payload.recordId, "PUT", payload, {
    token,
  });
  assert.equal((await saved.json()).run.score.status, "needs_review");
});

test("reports reject raw code/key fields, redact common leaked secrets, and bound request bytes", async () => {
  const payload = report({
    limitations: [
      "access_token=secret-value-123456789 sk-or-v1-abcdefghijklmnopqrstu " +
        token,
    ],
  });
  assert.equal(
    (
      await call(
        "/api/agent/runs/" + payload.recordId,
        "PUT",
        { ...payload, sourceCode: "original product source" },
        { token },
      )
    ).status,
    400,
  );
  const response = await call(
    "/api/agent/runs/" + payload.recordId,
    "PUT",
    payload,
    { token },
  );
  const data = JSON.stringify(await response.json());
  assert.ok(!data.includes("secret-value-123456789"));
  assert.ok(!data.includes("sk-or-v1-"));
  assert.ok(!data.includes(token));
  assert.equal(
    (
      await call(
        "/api/agent/runs/" + payload.recordId,
        "PUT",
        { ...payload, padding: "x".repeat(256 * 1024) },
        { token },
      )
    ).status,
    413,
  );
});

test("redaction cannot persist duplicate check IDs or malformed local model identifiers", async () => {
  const payload = report({
    checks: [
      {
        id: "pst_" + "a".repeat(43),
        name: "First",
        method: "automated",
        required: true,
        status: "passed",
      },
      {
        id: "pst_" + "b".repeat(43),
        name: "Second",
        method: "automated",
        required: true,
        status: "failed",
      },
    ],
  });
  assert.equal(
    (
      await call("/api/agent/runs/" + payload.recordId, "PUT", payload, {
        token,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/agent/heartbeat",
        "POST",
        {
          models: [
            {
              id: token,
              name: "Secret pasted into model",
              contextLength: 32768,
              tools: true,
              vision: true,
            },
          ],
        },
        { token },
      )
    ).status,
    400,
  );
  const list = await call(
    "/api/projects/" + projectId + "/runs",
    "GET",
    undefined,
    { cookie: alice },
  );
  const stored = (await list.json()).runs.find(
    (run: { recordId: string }) => run.recordId === payload.recordId,
  );
  assert.equal(stored.checks[0].id, "unit");
});

test("deleting a project deletes only its reports and revokes its agent access", async () => {
  assert.equal(
    (
      await call("/api/projects/" + projectId, "DELETE", undefined, {
        cookie: bob,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call("/api/projects/" + projectId, "DELETE", undefined, {
        cookie: alice,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call("/api/agent/config", "GET", undefined, { token })).status,
    401,
  );
  const count = await runtime.database.query<{ count: string }>(
    "SELECT count(*) AS count FROM qa_runs WHERE project_id = $1",
    [projectId],
  );
  assert.equal(Number(count.rows[0].count), 0);
  assert.equal(
    (await call("/api/session", "GET", undefined, { cookie: bob })).status,
    200,
  );
});

test("email login verifies credentials and database rate limits survive restart", async () => {
  const successful = await call("/api/auth/sign-in/email", "POST", {
    email: "alice@example.test",
    password: "Correct-horse-local-test-password-42",
  });
  assert.equal(successful.status, 200);
  const login = () =>
    call("/api/auth/sign-in/email", "POST", {
      email: "alice@example.test",
      password: "Incorrect-long-password-42",
    });
  assert.equal((await login()).status, 401);
  let last: Response | undefined;
  for (let index = 0; index < 8; index++) last = await login();
  assert.equal(last?.status, 429);
  const counts = await runtime.database.query<{ count: string }>(
    'SELECT count(*) AS count FROM "rateLimit"',
  );
  assert.ok(Number(counts.rows[0].count) > 0);
  await runtime.database.end();
  const database = await createPGliteDatabase(
    join(directory, "fresh-parent", "database"),
  );
  runtime = { database, auth: createAuth(database, config), config };
  assert.equal((await login()).status, 429);
});

test("production fails closed without persistent credentials and cannot use PGlite", async () => {
  assert.equal(authConfig({ NODE_ENV: "production" }), null);
  assert.throws(
    () =>
      authConfig({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://app.example",
        BETTER_AUTH_SECRET: config.secret,
        PGLITE_DATA_DIR: "/tmp/dev-only",
      }),
    /Production requires/,
  );
  assert.throws(
    () =>
      authConfig({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "http://app.example",
        BETTER_AUTH_SECRET: config.secret,
        DATABASE_URL: "postgres://database",
      }),
    /Production requires/,
  );
  await assert.rejects(
    createDatabase({
      NODE_ENV: "production",
      PGLITE_DATA_DIR: "/tmp/dev-only",
    }),
    /not configured/,
  );
  const response = await handleRequest(request("/api/session"), null);
  assert.deepEqual(await response.json(), { user: null, configured: false });
  assert.equal(
    (await handleRequest(request("/api/projects"), null)).status,
    503,
  );
});
