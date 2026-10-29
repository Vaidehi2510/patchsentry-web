import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { createRequire } from "node:module";
const generate = promisify(crypto.generateKeyPair);
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const label = (r) =>
  Buffer.from(`patchsentry:${r.projectId}:${r.runnerId}:${r.id}:${r.backend}`);
async function privateFile(file) {
  const s = await fs.lstat(file);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.nlink !== 1 ||
    s.size > 32768 ||
    s.mode & 0o077
  )
    throw new Error("Model setup files must be private regular files");
  return fs.readFile(file, "utf8");
}
export async function prepareModelSetup({
  bot,
  runner,
  options,
  trustedPath,
  projectId,
}) {
  if (!options.allowModelSetup) return null;
  const root = await trustedPath(
    bot.botDir,
    `.qa-local/model-setup/${runner.heartbeat.id}/${hash(projectId).slice(0, 32)}`,
    { missing: true },
  );
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const filename = await trustedPath(
    bot.botDir,
    path.join(root, "private.pem"),
    { missing: true },
  );
  let privateKey;
  try {
    privateKey = await privateFile(filename);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const generated = await generate("rsa", {
      modulusLength: 3072,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    try {
      await fs.writeFile(filename, generated.privateKey, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    privateKey = await privateFile(filename);
  }
  const publicKey = crypto
      .createPublicKey(privateKey)
      .export({ type: "spki", format: "pem" })
      .toString(),
    backends = options.allowedBackends || [
      bot.config.ai?.backend || "openrouter",
    ];
  runner.heartbeat.modelSetup = { publicKey, backends };
  return {
    root,
    projectId,
    runnerId: runner.heartbeat.id,
    privateKey,
    publicKey,
    fingerprint: hash(publicKey),
    backends,
  };
}
function decrypt(state, r) {
  return crypto
    .privateDecrypt(
      {
        key: state.privateKey,
        oaepHash: "sha256",
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepLabel: label(r),
      },
      Buffer.from(r.sealedKey, "base64"),
    )
    .toString();
}
export async function setupEnvironment(state, env) {
  const effective = { ...env };
  if (!state) return effective;
  for (const backend of ["openrouter", "local"]) {
    try {
      const record = JSON.parse(
        await privateFile(path.join(state.root, backend + ".json")),
      );
      if (
        record.projectId !== state.projectId ||
        record.runnerId !== state.runnerId
      )
        throw new Error();
      const value = decrypt(state, record);
      if (value.length > 256 || /[^!-~]/.test(value)) throw new Error();
      effective[
        backend === "openrouter" ? "OPENROUTER_API_KEY" : "LOCAL_MODEL_API_KEY"
      ] = value;
    } catch (e) {
      if (e.code !== "ENOENT")
        throw new Error(
          "The runner’s encrypted model credential could not be loaded. Remove its saved runner key, then reconnect.",
        );
    }
  }
  return effective;
}
/** @param {{state:any,bot:any,runner:any,portal:any,remote:any,env:any,trustedPath:Function,writeConfig:Function,fetchImpl?:typeof fetch}} options */
export async function processModelSetup({
  state,
  bot,
  runner,
  portal,
  remote,
  env,
  trustedPath,
  writeConfig,
  fetchImpl,
}) {
  if (!state) return { status: "disabled" };
  const claim = await portal.request("POST", "/api/agent/model-setup/claim", {
    runnerId: runner.heartbeat.id,
  });
  if (!claim.request) return { status: "idle" };
  const r = claim.request;
  const ack = (status, result) =>
    portal.request("POST", `/api/agent/model-setup/${r.id}/complete`, {
      runnerId: runner.heartbeat.id,
      claimToken: claim.claimToken,
      status,
      result,
    });
  let result;
  try {
    if (
      !/^[a-f0-9-]{36}$/.test(r.id || "") ||
      !/^[A-Za-z0-9_-]{43}$/.test(claim.claimToken || "") ||
      r.projectId !== remote.projectId ||
      r.runnerId !== runner.heartbeat.id ||
      r.fingerprint !== state.fingerprint ||
      !["openrouter", "local"].includes(r.backend) ||
      !state.backends.includes(r.backend) ||
      !["configure", "discover", "test", "disconnect"].includes(r.action)
    )
      throw new Error("Invalid model setup request");
    const settings = createRequire(import.meta.url)(
      await trustedPath(bot.botDir, "src/ai/settings.js"),
    );
    const local = r.local
      ? settings.validateLocalConfig(r.local)
      : bot.config.ai?.local;
    if (r.backend === "local" && !local && r.action !== "disconnect")
      throw new Error("Configure a local endpoint first");
    let apiKey;
    if (r.sealedKey !== null && r.sealedKey !== undefined) {
      if (typeof r.sealedKey !== "string" || r.sealedKey.length > 1024)
        throw new Error();
      apiKey = decrypt(state, r);
      if (apiKey.length > 256 || /[^!-~]/.test(apiKey)) throw new Error();
    }
    if (r.action === "disconnect") {
      await fs.rm(path.join(state.root, r.backend + ".json"), { force: true });
      result = {
        message:
          "Saved runner credential removed. Any separately configured environment credential remains under local operator control.",
        credentialPresent: false,
      };
    } else {
      const effective = await setupEnvironment(state, env);
      if (apiKey !== undefined)
        effective[
          r.backend === "openrouter"
            ? "OPENROUTER_API_KEY"
            : "LOCAL_MODEL_API_KEY"
        ] = apiKey;
      if (r.backend === "openrouter" && !effective.OPENROUTER_API_KEY)
        throw Object.assign(new Error(), { status: 401 });
      const Client = createRequire(import.meta.url)(
        await trustedPath(
          bot.botDir,
          r.backend === "local" ? "src/ai/local.js" : "src/ai/openrouter.js",
        ),
      );
      const client =
        r.backend === "local"
          ? new Client.LocalModelClient({
              ...local,
              apiKey: effective.LOCAL_MODEL_API_KEY || "",
              timeoutMs: 20000,
              ...(fetchImpl ? { fetchImpl } : {}),
            })
          : new Client.OpenRouterClient({
              apiKey: effective.OPENROUTER_API_KEY,
              timeoutMs: 20000,
              maxRetries: 0,
              ...(fetchImpl ? { fetchImpl } : {}),
            });
      const models = (await client.listModels()).filter(
        (m) =>
          typeof m.id === "string" &&
          m.id.length <= 160 &&
          !/(?:sk-or-v1-|sk-proj-|ghp_|pst_|Bearer)/i.test(m.id) &&
          ![effective.OPENROUTER_API_KEY, effective.LOCAL_MODEL_API_KEY]
            .filter(Boolean)
            .some((secret) => m.id.includes(secret)),
      );
      if (r.action === "test") {
        if (
          typeof r.model !== "string" ||
          !models.some((m) => m.id === r.model)
        )
          throw Object.assign(new Error(), { status: 404 });
        const reply = await client.chat({
          model: r.model,
          messages: [
            {
              role: "user",
              content:
                "Reply with OK. This is a connection check; no product data is included.",
            },
          ],
          maxTokens: 32,
          ...(r.backend === "openrouter"
            ? { provider: bot.config.ai?.provider }
            : {}),
        });
        if (
          typeof reply.message?.content !== "string" ||
          !reply.message.content.trim()
        )
          throw new Error("No usable reply within the connection-check limit");
        result = {
          message:
            "The selected model returned a reply to the bounded connection check. This does not certify QA quality or every tool/image capability.",
          inferencePassed: true,
          credentialPresent: Boolean(
            r.backend === "openrouter"
              ? effective.OPENROUTER_API_KEY
              : effective.LOCAL_MODEL_API_KEY,
          ),
        };
      } else if (r.action === "discover")
        result = {
          message:
            "Local server reached. Select a returned model and declare its actual capabilities before saving it.",
          models: models.slice(0, 100).map((m) => ({ id: m.id })),
          endpoint: local.baseUrl,
        };
      else {
        if (r.backend === "local") {
          if (
            !r.local ||
            !r.local.models.length ||
            r.local.models.some((p) => !models.some((m) => m.id === p.id))
          )
            throw new Error("Declared local model is not served");
          const next = { ...bot.config, ai: { ...bot.config.ai, local } };
          settings.validateAIConfig(next.ai);
          await writeConfig(bot, next);
        }
        if (apiKey !== undefined) {
          const file = await trustedPath(
              bot.botDir,
              path.join(state.root, r.backend + ".json"),
              { missing: true },
            ),
            temporary = file + "." + crypto.randomUUID() + ".tmp";
          try {
            await fs.writeFile(
              temporary,
              JSON.stringify({
                id: r.id,
                projectId: r.projectId,
                runnerId: r.runnerId,
                backend: r.backend,
                sealedKey: r.sealedKey,
              }),
              { flag: "wx", mode: 0o600 },
            );
            await fs.rename(temporary, file);
          } finally {
            await fs.rm(temporary, { force: true });
          }
        }
        result = {
          message:
            r.backend === "openrouter"
              ? "Verified key installed on this runner. Choose a model and run the inference check next."
              : "Local endpoint and declared profiles saved on the runner. Run an inference check next.",
          credentialPresent: Boolean(
            apiKey ??
              (r.backend === "openrouter"
                ? effective.OPENROUTER_API_KEY
                : effective.LOCAL_MODEL_API_KEY),
          ),
          ...(r.backend === "local"
            ? {
                endpoint: local.baseUrl,
                models: models.slice(0, 100).map((m) => ({ id: m.id })),
              }
            : {}),
        };
      }
    }
  } catch (e) {
    result = {
      message:
        e.status === 401
          ? "Authentication was rejected or no key is installed. Reconnect the provider."
          : e.status === 402
            ? "Provider credits or a spending limit blocked this request."
            : e.status === 429
              ? "Provider rate limit reached. Wait before requesting another check."
              : e.status === 404
                ? "The requested model is not available on this server."
                : "The connection check failed. Check runner logs, endpoint availability, model limits and local enrollment. No provider response or credential was uploaded.",
    };
    await ack("failed", result);
    return { status: "failed" };
  }
  // Never repeat a model call just because acknowledgement fails.
  await ack("passed", result);
  return { status: "passed" };
}
