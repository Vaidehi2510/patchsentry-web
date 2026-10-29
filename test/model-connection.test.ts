import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  privateDecrypt,
  constants,
  randomUUID,
} from "node:crypto";
import { createPGliteDatabase } from "../src/lib/server/database";
import { createAuth, migrateDatabase } from "../src/lib/server/auth";
import { handleRequest } from "../src/lib/server/api";
import {
  requestModelSetup,
  claimModelSetup,
  completeModelSetup,
  modelConnections,
} from "../src/lib/server/model-connection";
import { secureSession } from "./auth-session";
import type { Runtime } from "../src/lib/server/runtime";
const keys = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { format: "pem", type: "spki" },
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
});
const emails = new Map<string, string>(),
  accounts: Record<string, string> = {};
const config = {
  origin: "https://portal.example",
  secret: "model-setup-fixture-only-secret-at-least-32-characters",
  production: false,
  sendSignInLink: async ({ email, url }: { email: string; url: string }) => {
    emails.set(email, url);
  },
};
let runtime: Runtime;
let validations = 0;
const key = "sk-or-v1-" + "f".repeat(50),
  runnerId = "e".repeat(64);
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  who = "owner",
  token?: string,
) {
  return handleRequest(
    new Request(config.origin + path, {
      method,
      headers: {
        origin: config.origin,
        "content-type": "application/json",
        "x-forwarded-for": who === "owner" ? "192.0.2.101" : "192.0.2.102",
        ...(token
          ? { authorization: `Bearer ${token}` }
          : { cookie: accounts[who] || "" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    runtime,
  );
}
before(async () => {
  const database = await createPGliteDatabase();
  await migrateDatabase(database, config);
  runtime = {
    database,
    config,
    auth: createAuth(database, config),
    connectionFetch: async (url, options) => {
      validations++;
      assert.equal(url, "https://openrouter.ai/api/v1/key");
      assert.equal(
        new Headers(options?.headers).get("authorization"),
        `Bearer ${key}`,
      );
      assert.equal(options?.redirect, "error");
      return new Response(
        JSON.stringify({ data: { limit: 10, is_free_tier: false } }),
      );
    },
  };
  for (const who of ["owner", "viewer", "outsider"]) {
    const email = who + "@example.test";
    await api(
      "/api/auth/sign-in/magic-link",
      "POST",
      { email, name: who },
      who,
    );
    const u = new URL(emails.get(email)!);
    const r = await api(u.pathname + u.search);
    accounts[who] = await secureSession(
      runtime,
      r.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    );
  }
});
after(() => runtime.database.end());
async function project() {
  const { project: p } = await (
    await api("/api/projects", "POST", {
      name: "Model setup",
      repository: "fixture/product-" + randomUUID(),
    })
  ).json();
  const { token } = await (
    await api(`/api/projects/${p.id}/token`, "POST", {})
  ).json();
  const runner = {
    id: runnerId,
    executeJobs: false,
    ready: false,
    missing: [],
    browsers: [],
    backends: ["openrouter", "local"],
    maxPages: 1,
    maxCostUsd: 1,
    maxCallsPerRun: 1,
    modelSetup: {
      publicKey: keys.publicKey,
      backends: ["openrouter", "local"],
    },
  };
  const heartbeat = await api(
    "/api/agent/heartbeat",
    "POST",
    { models: [], runner },
    "owner",
    token,
  );
  assert.equal(heartbeat.status, 200, await heartbeat.text());
  return { ...p, token, runner };
}
const setup = (extra: Record<string, unknown> = {}) => ({
  runnerId,
  backend: "openrouter",
  action: "configure",
  apiKey: key,
  consent: true,
  ...extra,
});
async function claim(p: any) {
  return claimModelSetup(runtime, p.id, { runnerId });
}
async function ack(
  p: any,
  c: any,
  status = "passed",
  result: any = { message: "Fixture check complete" },
) {
  return completeModelSetup(runtime, p.id, c.request.id, {
    runnerId,
    claimToken: c.claimToken,
    status,
    result,
  });
}

test("verified OpenRouter key is encrypted for one runner, never persisted or returned as plaintext, and wiped after acknowledgement", async () => {
  const p = await project();
  const r = await api(
    `/api/projects/${p.id}/model-connections`,
    "POST",
    setup(),
  );
  assert.equal(r.status, 201, await r.clone().text());
  assert.equal(validations, 1);
  assert.ok(!JSON.stringify(await r.json()).includes(key));
  const row = (
    await runtime.database.query<any>(
      "SELECT * FROM qa_model_setup WHERE project_id=$1",
      [p.id],
    )
  ).rows[0];
  assert.ok(row.key_verified_at);
  assert.ok(row.sealed_key);
  assert.ok(!JSON.stringify(row).includes(key));
  const c = await claim(p);
  assert.equal(
    privateDecrypt(
      {
        key: keys.privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
        oaepLabel: Buffer.from(
          `patchsentry:${p.id}:${runnerId}:${c.request.id}:openrouter`,
        ),
      },
      Buffer.from(c.request.sealedKey, "base64"),
    ).toString(),
    key,
  );
  assert.throws(() =>
    privateDecrypt(
      {
        key: keys.privateKey,
        oaepHash: "sha256",
        oaepLabel: Buffer.from("other-project"),
      },
      Buffer.from(c.request.sealedKey, "base64"),
    ),
  );
  assert.equal((await claim(p)).request, null);
  const publicView = await modelConnections(runtime, p.id);
  assert.ok(!JSON.stringify(publicView).includes(row.sealed_key));
  await ack(p, c);
  assert.equal(
    (
      await runtime.database.query<any>(
        "SELECT sealed_key FROM qa_model_setup WHERE id=$1",
        [row.id],
      )
    ).rows[0].sealed_key,
    null,
  );
  await assert.rejects(() => ack(p, c));
});

test("model setup requires full authentication, owner/admin permissions and project boundaries", async () => {
  const p = await project(),
    root = `/api/projects/${p.id}/model-connections`;
  const invite = await (
    await api(`/api/projects/${p.id}/team`, "POST", {
      email: "viewer@example.test",
      role: "viewer",
    })
  ).json();
  await api(
    "/api/invitations/accept",
    "POST",
    { token: invite.token },
    "viewer",
  );
  assert.equal((await api(root, "POST", setup(), "viewer")).status, 403);
  assert.equal((await api(root, "GET", undefined, "viewer")).status, 200);
  assert.equal((await api(root, "POST", setup(), "outsider")).status, 404);
  assert.equal((await api(root, "GET", undefined, "missing")).status, 401);
  assert.equal(
    (await api("/api/agent/model-setup/claim", "POST", { runnerId })).status,
    401,
  );
});

test("local discovery rejects non-loopback addresses before network, requires consent and never contacts OpenRouter", async () => {
  const p = await project(),
    start = validations;
  for (const baseUrl of [
    "http://169.254.169.254/v1",
    "https://example.com/v1",
    "http://127.0.0.1:11434/v1/../admin",
    "http://127.0.0.1:99999/v1",
    "http://localhost/v1",
  ])
    await assert.rejects(() =>
      requestModelSetup(
        runtime,
        p.id,
        setup({
          backend: "local",
          action: "discover",
          apiKey: undefined,
          local: { baseUrl, models: [] },
        }),
      ),
    );
  await assert.rejects(() =>
    requestModelSetup(runtime, p.id, setup({ consent: false })),
  );
  const queued = await requestModelSetup(
    runtime,
    p.id,
    setup({
      backend: "local",
      action: "discover",
      apiKey: undefined,
      local: { baseUrl: "http://127.0.0.1:11434/v1", models: [] },
    }),
  );
  assert.equal(queued.connection.status, "queued");
  assert.equal(validations, start);
});

test("invalid OpenRouter credentials fail closed without enqueuing keys and failed verifications are rate limited", async () => {
  const p = await project(),
    original = runtime.connectionFetch;
  runtime.connectionFetch = async () => new Response("denied", { status: 401 });
  try {
    for (let i = 0; i < 30; i++)
      await assert.rejects(
        () => requestModelSetup(runtime, p.id, setup()),
        /could not be verified/,
      );
    await assert.rejects(
      () => requestModelSetup(runtime, p.id, setup()),
      /limit reached/,
    );
    assert.equal((await modelConnections(runtime, p.id)).connections.length, 0);
  } finally {
    runtime.connectionFetch = original;
  }
});

test("expired model checks are uncertain, never automatically retried and cannot acknowledge an expired lease", async () => {
  const p = await project();
  await requestModelSetup(
    runtime,
    p.id,
    setup({ action: "test", apiKey: undefined, model: "fixture/model" }),
  );
  const c = await claim(p);
  await runtime.database.query(
    "UPDATE qa_model_setup SET claimed_at=now()-interval '3 minutes' WHERE id=$1",
    [c.request.id],
  );
  assert.equal((await claim(p)).request, null);
  await assert.rejects(() => ack(p, c));
  const listed = await modelConnections(runtime, p.id);
  assert.equal(listed.connections[0].status, "uncertain");
});

test("runner encryption identity is pinned; another project token cannot claim or acknowledge its request", async () => {
  const p = await project(),
    other = await project();
  await requestModelSetup(runtime, p.id, setup());
  const c = await claim(p);
  assert.equal(
    (
      await api(
        `/api/agent/model-setup/${c.request.id}/complete`,
        "POST",
        {
          runnerId,
          claimToken: c.claimToken,
          status: "passed",
          result: { message: "wrong project" },
        },
        "owner",
        other.token,
      )
    ).status,
    409,
  );
  const second = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const replace = await api(
    "/api/agent/heartbeat",
    "POST",
    {
      models: [],
      runner: {
        ...p.runner,
        modelSetup: { ...p.runner.modelSetup, publicKey: second.publicKey },
      },
    },
    "owner",
    p.token,
  );
  assert.equal(replace.status, 409);
  await ack(p, c);
});

test("complete connector sync enrolls a real key, claims setup through the real HTTP client and acknowledges once", async (t) => {
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const { syncOnce, PortalClient } = await import("../scripts/agent.mjs");
  const botDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "model-sync-")),
  );
  t.after(() => fs.rm(botDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(botDir, "src/ai"), { recursive: true });
  await fs.writeFile(
    path.join(botDir, "package.json"),
    JSON.stringify({ name: "qa-signoff-bot" }),
  );
  await fs.writeFile(
    path.join(botDir, "qa-config.json"),
    JSON.stringify({ ai: { enabled: false, backend: "openrouter" } }),
  );
  await fs.writeFile(
    path.join(botDir, "src/ai/settings.js"),
    "module.exports={};",
  );
  const p = await project();
  const client = new PortalClient({
    url: config.origin,
    token: p.token,
    fetchImpl: async (url: any, init: any) =>
      handleRequest(new Request(url, init), runtime),
  });
  const options = {
    botDir,
    allowModelSetup: true,
    allowedBackends: ["openrouter", "local"],
  };
  const first = await syncOnce({ options, env: {}, client });
  assert.ok("modelSetup" in first);
  assert.equal(first.modelSetup?.status, "idle");
  const worker = (await modelConnections(runtime, p.id)).runners.find(
    (w) => w.id !== runnerId,
  )!;
  assert.ok(worker.fingerprint);
  await requestModelSetup(runtime, p.id, {
    runnerId: worker.id,
    backend: "openrouter",
    action: "disconnect",
    consent: true,
  });
  const second = await syncOnce({ options, env: {}, client });
  assert.ok("modelSetup" in second);
  assert.equal(second.modelSetup?.status, "passed");
  assert.equal(
    (await modelConnections(runtime, p.id)).connections[0].status,
    "passed",
  );
  const final = await syncOnce({ options, env: {}, client });
  assert.ok("modelSetup" in final);
  assert.equal(final.modelSetup?.status, "idle");
});
