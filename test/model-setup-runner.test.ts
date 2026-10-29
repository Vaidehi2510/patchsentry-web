import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publicEncrypt, constants, randomUUID } from "node:crypto";
import {
  prepareModelSetup,
  processModelSetup,
  setupEnvironment,
} from "../scripts/model-setup.mjs";
import { trustedPath } from "../scripts/agent.mjs";
async function fixture(t: any) {
  const botDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "model-setup-")),
  );
  t.after(() => fs.rm(botDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(botDir, "src/ai"), { recursive: true });
  await fs.writeFile(
    path.join(botDir, "src/ai/settings.js"),
    `exports.validateLocalConfig=v=>{if(v.baseUrl!=='http://127.0.0.1:11434/v1')throw new Error();return v};exports.validateAIConfig=()=>{};`,
  );
  const client = `class Client{constructor(options){this.o=options;}async listModels(){return (await (await this.o.fetchImpl('http://127.0.0.1:11434/v1/models',{headers:{Authorization:'Bearer '+this.o.apiKey}})).json()).data;}async chat(body){return (await this.o.fetchImpl('http://127.0.0.1:11434/v1/chat/completions',{body:JSON.stringify(body)})).json();}};exports.LocalModelClient=Client;exports.OpenRouterClient=Client;`;
  for (const file of ["local.js", "openrouter.js"])
    await fs.writeFile(path.join(botDir, "src/ai", file), client);
  const bot = {
      botDir,
      config: {
        ai: {
          enabled: false,
          backend: "local",
          local: {
            baseUrl: "http://127.0.0.1:11434/v1",
            models: [
              {
                id: "fixture:8b",
                contextLength: 8192,
                tools: true,
                vision: false,
              },
            ],
          },
        },
      },
    },
    runner = { heartbeat: { id: "a".repeat(64) } },
    options = {
      allowModelSetup: true,
      allowedBackends: ["local", "openrouter"],
    },
    projectId = randomUUID();
  const state = await prepareModelSetup({
    bot,
    runner,
    options,
    trustedPath,
    projectId,
  });
  assert.ok(state);
  let request: any;
  const calls: any[] = [],
    network: any[] = [];
  const portal = {
    request: async (method: string, url: string, body: any) => {
      calls.push({ method, url, body });
      return url.endsWith("/claim")
        ? { request, claimToken: "b".repeat(43) }
        : { ok: true };
    },
  };
  const fetchImpl = async (url: any, options: any) => {
    network.push({ url, options });
    return new Response(
      JSON.stringify(
        url.endsWith("/models")
          ? { data: [{ id: "fixture:8b" }] }
          : { message: { content: "OK" } },
      ),
    );
  };
  const process = () =>
    processModelSetup({
      state,
      bot,
      runner,
      portal,
      remote: { projectId },
      env: {},
      trustedPath,
      fetchImpl,
      writeConfig: async (_: any, next: any) => {
        bot.config = next;
      },
    });
  const set = (extra: any = {}) => {
    request = {
      id: randomUUID(),
      projectId,
      runnerId: runner.heartbeat.id,
      fingerprint: state.fingerprint,
      backend: "local",
      action: "test",
      model: "fixture:8b",
      sealedKey: null,
      ...extra,
    };
    return request;
  };
  const seal = (key: string) => {
    request.sealedKey = publicEncrypt(
      {
        key: state.publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
        oaepLabel: Buffer.from(
          `patchsentry:${projectId}:${runner.heartbeat.id}:${request.id}:${request.backend}`,
        ),
      },
      Buffer.from(key),
    ).toString("base64");
  };
  return {
    bot,
    runner,
    state,
    projectId,
    options,
    calls,
    network,
    set,
    seal,
    process,
    portal,
  };
}
test("setup is opt-in, pins private keys to a project, and uses owner-only credential files", async (t) => {
  const f = await fixture(t);
  assert.equal(
    await prepareModelSetup({
      bot: f.bot,
      runner: f.runner,
      options: {},
      trustedPath,
      projectId: f.projectId,
    }),
    null,
  );
  assert.equal(
    (await processModelSetup({ state: null } as any)).status,
    "disabled",
  );
  assert.equal(
    (await fs.stat(path.join(f.state.root, "private.pem"))).mode & 0o777,
    0o600,
  );
  const same = await prepareModelSetup({
    bot: f.bot,
    runner: f.runner,
    options: f.options,
    trustedPath,
    projectId: f.projectId,
  });
  assert.ok(same);
  assert.equal(same.fingerprint, f.state.fingerprint);
  const other = await prepareModelSetup({
    bot: f.bot,
    runner: f.runner,
    options: f.options,
    trustedPath,
    projectId: randomUUID(),
  });
  assert.ok(other);
  assert.notEqual(other.fingerprint, f.state.fingerprint);
});
test("local discovery lists real returned IDs; configuration preserves activation and stores only an encrypted credential", async (t) => {
  const f = await fixture(t),
    secret = "fixture-local-private-key";
  f.set({
    action: "discover",
    local: { baseUrl: "http://127.0.0.1:11434/v1", models: [] },
  });
  f.seal(secret);
  assert.equal((await f.process()).status, "passed");
  assert.equal(f.network.length, 1);
  assert.equal(f.calls.at(-1).body.result.models[0].id, "fixture:8b");
  assert.ok(!JSON.stringify(f.calls).includes(secret));
  f.set({ action: "configure", local: f.bot.config.ai.local });
  f.seal(secret);
  assert.equal((await f.process()).status, "passed");
  const stored = path.join(f.state.root, "local.json");
  assert.ok(!(await fs.readFile(stored, "utf8")).includes(secret));
  assert.equal((await fs.stat(stored)).mode & 0o777, 0o600);
  assert.equal(
    (await setupEnvironment(f.state, {})).LOCAL_MODEL_API_KEY,
    secret,
  );
  assert.equal(f.bot.config.ai.enabled, false);
  f.set({ action: "disconnect" });
  await f.process();
  assert.equal(
    (await setupEnvironment(f.state, {})).LOCAL_MODEL_API_KEY,
    undefined,
  );
});
test("model probe is a single bounded synthetic request, uses installed keys, and uploads no reply or source data", async (t) => {
  const f = await fixture(t);
  f.set();
  assert.equal((await f.process()).status, "passed");
  const calls = f.network.filter((n) => n.url.endsWith("/chat/completions"));
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.maxTokens, 32);
  assert.equal(body.messages.length, 1);
  assert.equal(
    body.messages[0].content,
    "Reply with OK. This is a connection check; no product data is included.",
  );
  assert.equal(f.calls.at(-1).body.result.inferencePassed, true);
  assert.ok(!("content" in f.calls.at(-1).body.result));
});
test("cross-runner envelopes and unavailable models fail without inference and never upload exception details", async (t) => {
  const f = await fixture(t);
  f.set({ model: "missing:8b" });
  assert.equal((await f.process()).status, "failed");
  assert.equal(
    f.network.filter((n) => n.url.endsWith("/chat/completions")).length,
    0,
  );
  assert.match(f.calls.at(-1).body.result.message, /not available/);
  f.network.length = 0;
  f.set({ runnerId: "c".repeat(64) });
  assert.equal((await f.process()).status, "failed");
  assert.equal(f.network.length, 0);
});
test("lost acknowledgement never repeats a model call and corrupted encrypted files fail closed", async (t) => {
  const f = await fixture(t);
  f.set();
  const request = f.portal.request;
  f.portal.request = async (...args: any[]) => {
    if (args[1].endsWith("/complete")) throw new Error("lost ack");
    return request(...(args as [string, string, any]));
  };
  await assert.rejects(() => f.process(), /lost ack/);
  assert.equal(
    f.network.filter((n) => n.url.endsWith("/chat/completions")).length,
    1,
  );
  await fs.writeFile(path.join(f.state.root, "local.json"), "invalid", {
    mode: 0o600,
  });
  await assert.rejects(
    () => setupEnvironment(f.state, {}),
    /could not be loaded/,
  );
});

test("real portal client permits only the fixed model-setup claim and completion routes", async () => {
  const { PortalClient } = await import("../scripts/agent.mjs");
  const paths: string[] = [];
  const client = new PortalClient({
    url: "https://portal.example",
    token: "fixture-token-at-least-16-characters",
    fetchImpl: async (url: any) => {
      paths.push(String(url));
      return new Response("{}");
    },
  });
  await client.request("POST", "/api/agent/model-setup/claim", {});
  await client.request(
    "POST",
    "/api/agent/model-setup/" + randomUUID() + "/complete",
    {},
  );
  assert.equal(paths.length, 2);
  await assert.rejects(
    () => client.request("POST", "/api/agent/model-setup/../../admin", {}),
    /Unsupported/,
  );
});
