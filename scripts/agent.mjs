#!/usr/bin/env node
/** Outbound-only bridge. No source checkout, model execution, or GitHub mutation. */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const ROLES = ["planner", "code-review", "security", "ui-ux", "triage"];
const STATUSES = [
  "passed",
  "failed",
  "blocked",
  "skipped",
  "pending",
  "running",
  "execution_error",
  "awaiting_human",
  "unsupported",
];
const BACKENDS = ["openrouter", "local"];
const SETTINGS = [
  "backend",
  "model",
  "roleModels",
  "roles",
  "maxCostUsd",
  "maxCallsPerRun",
  "allowImages",
];
const REPOSITORY = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const SHA = /^[a-fA-F0-9]{40,64}$/;
const MODEL = /^[a-zA-Z0-9_./:@+\-]*$/;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fail = (message) => {
  throw new Error(message);
};

export function sanitizeText(value, max = 1200) {
  if (typeof value !== "string") return "";
  // Operate on bounded input before regex processing. This is deliberately lossy.
  return value
    .slice(0, 20000)
    .replace(
      /-----BEGIN [^-\r\n]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-\r\n]+-----|$)/g,
      "[redacted]",
    )
    .replace(
      /\b(?:pst_|sk-or-v1-|sk-proj-|sk-ant-|ghp_|gho_|ghs_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g,
      "[redacted]",
    )
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[redacted]")
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|authorization)["']?\s*[=:]\s*["']?(?:Bearer\s+)?[^\s,"';]{4,}/gi,
      "[redacted credential]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9_.+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi, "[redacted URL]")
    .replace(/https?:\/\/[^\s<>]+/gi, "[link omitted]")
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "[code omitted]")
    .replace(/`[^`\n]*`/g, "[code omitted]")
    .replace(/^\s*>.*$/gm, "[quotation omitted]")
    .replace(/^(?: {4}|\t).*$/gm, "[code omitted]")
    .replace(/["“][^"”\n]{1,2000}["”]/g, "[quotation omitted]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function safeFile(value) {
  if (
    typeof value !== "string" ||
    value.length > 300 ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("\\") ||
    value.split("/").includes("..") ||
    /[\x00-\x1f]/.test(value)
  )
    return undefined;
  return sanitizeText(value, 300) || undefined;
}
function date(value, nullable = false) {
  const stamp =
    typeof value === "string" && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : null;
  if (!stamp && !nullable)
    fail("Run has no valid creation timestamp; upload skipped.");
  return stamp;
}
function finite(value, max) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
  );
}
function modelId(value) {
  return (
    typeof value === "string" &&
    value.length <= 160 &&
    MODEL.test(value) &&
    sanitizeText(value, 160) === value
  );
}
function checkStatus(check, run) {
  if (check.method === "analysis")
    return check.revision === run.revision &&
      ["passed", "execution_error"].includes(check.analysisStatus)
      ? check.analysisStatus
      : "blocked";
  if (check.method === "human") {
    const decisions = (
      Array.isArray(run.decisions) ? run.decisions : []
    ).filter(
      (d) =>
        object(d) &&
        !d.invalidatedAt &&
        d.checkId === check.id &&
        d.revision === run.revision,
    );
    const decision = decisions
      .sort(
        (a, b) =>
          (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0),
      )
      .at(-1);
    return decision?.result === "pass"
      ? "passed"
      : decision?.result === "fail"
        ? "failed"
        : "awaiting_human";
  }
  if (check.method !== "automated") return "unsupported";
  const results = (Array.isArray(run.results) ? run.results : []).filter(
    (r) =>
      object(r) &&
      r.checkId === check.id &&
      (!r.revision || r.revision === run.revision),
  );
  if (results.length > 1) return "execution_error";
  if (!results.length)
    return run.phase === "running"
      ? "running"
      : run.phase === "queued"
        ? "pending"
        : "blocked";
  const status = results[0].status;
  return STATUSES.includes(status) && status !== "awaiting_human"
    ? status
    : "execution_error";
}

/** Explicit allowlist. Never spread a run, finding, result, request, or AI transcript. */
export function serializeRun(run) {
  if (
    !object(run) ||
    typeof run.repository !== "string" ||
    !REPOSITORY.test(run.repository) ||
    run.repository.length > 201 ||
    !SHA.test(run.revision || "") ||
    !Number.isSafeInteger(run.pr?.number) ||
    run.pr.number < 1 ||
    typeof run.key !== "string" ||
    !run.key ||
    run.key.length > 500
  )
    fail("Run identity is invalid; upload skipped.");
  const plan = run.plan?.checks;
  if (!Array.isArray(plan) || plan.length > 200)
    fail("Run requires a complete plan of at most 200 checks; upload skipped.");
  const ids = new Set();
  const checks = plan.map((check) => {
    const id = sanitizeText(check?.id, 160);
    if (
      !object(check) ||
      typeof check.id !== "string" ||
      !id ||
      check.id.length > 160 ||
      /[\x00-\x1f]/.test(check.id) ||
      ids.has(id)
    )
      fail("Run check IDs are invalid or duplicated; upload skipped.");
    ids.add(id);
    const method = ["automated", "analysis", "human"].includes(check.method)
      ? check.method
      : "unsupported";
    return {
      id,
      name: sanitizeText(check.name || check.title || check.id, 240),
      method,
      required: check.required !== false,
      status: checkStatus(check, run),
    };
  });
  const assessments = [
    run.ai?.latest,
    run.ai?.completion,
    run.ai?.planning,
  ].filter((a) => object(a) && a.revision === run.revision);
  const assessment = assessments[0] || {};
  const limitations = [
    "Summaries omit source files, test logs, screenshots, transcripts, and proposed test code. Free-text summaries may still contain product information.",
  ];
  const backend = BACKENDS.includes(assessment.backend)
    ? assessment.backend
    : BACKENDS.includes(run.request?.config?.ai?.backend)
      ? run.request.config.ai.backend
      : "unknown";
  if (backend === "unknown")
    limitations.push(
      "This historical run did not record its inference backend.",
    );
  const severityOrder = ["critical", "high", "medium", "low", "info"];
  const rawFindings = [
    ...new Map(
      assessments
        .flatMap((a) =>
          Array.isArray(a.findings) ? a.findings.filter(object) : [],
        )
        .map((f) => [
          JSON.stringify([
            f.title,
            f.severity,
            f.category,
            f.file,
            f.description,
            f.suggestedFix,
          ]),
          f,
        ]),
    ).values(),
  ];
  if (rawFindings.length > 100)
    limitations.push("Only the 100 highest-severity findings are included.");
  const severityRank = (value) =>
    severityOrder.includes(value)
      ? severityOrder.indexOf(value)
      : severityOrder.length;
  const findings = [...rawFindings]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 100)
    .map((f) => ({
      title: sanitizeText(f.title, 240) || "Untitled finding",
      severity: severityOrder.includes(f.severity) ? f.severity : "info",
      category: sanitizeText(f.category, 80),
      ...(safeFile(f.file) ? { file: safeFile(f.file) } : {}),
      description: sanitizeText(f.description, 1600),
      ...(typeof f.suggestedFix === "string"
        ? { suggestedFix: sanitizeText(f.suggestedFix, 1600) }
        : {}),
      status: "unverified",
    }));
  for (const item of [
    ...assessments.flatMap((a) =>
      Array.isArray(a.limitations) ? a.limitations : [],
    ),
    ...(Array.isArray(run.limitations) ? run.limitations : []),
    ...(Array.isArray(run.screenshotLimitations)
      ? run.screenshotLimitations
      : []),
  ]) {
    const text = sanitizeText(item, 600);
    if (text && !limitations.includes(text) && limitations.length < 30)
      limitations.push(text);
  }
  const models = [
    ...new Set(
      assessments
        .flatMap((a) => (Array.isArray(a.roles) ? a.roles : []))
        .map((role) => role?.model)
        .filter(modelId),
    ),
  ];
  const model = modelId(assessment.model)
    ? assessment.model
    : models.join(", ").slice(0, 160);
  const calls =
    Number.isSafeInteger(assessment.budget?.calls) &&
    finite(assessment.budget.calls, 10000)
      ? assessment.budget.calls
      : 0;
  const recordId = hash(
    JSON.stringify([
      run.key,
      run.actionsRunId || "local",
      run.actionsAttempt || run.attempt || 1,
    ]),
  );
  const result = {
    schemaVersion: 1,
    recordId,
    repository: run.repository,
    pr: { number: run.pr.number, title: sanitizeText(run.pr.title, 300) },
    revision: run.revision,
    createdAt: date(run.createdAt),
    completedAt: date(run.completedAt, true),
    phase: sanitizeText(run.phase, 80),
    checks,
    findings,
    ai: {
      backend,
      model,
      costUsd: finite(assessment.cost, 10000) ? assessment.cost : null,
      costIsEstimate: assessment.costIsEstimate !== false,
      calls,
    },
    limitations,
  };
  // Retain the full denominator and risk list. Reduce free text before rejecting an oversized summary.
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PAYLOAD_BYTES) {
    result.findings = result.findings.map((f) => ({
      ...f,
      description: f.description.slice(0, 320),
      ...(f.suggestedFix ? { suggestedFix: f.suggestedFix.slice(0, 320) } : {}),
    }));
    if (result.limitations.length === 30) result.limitations.pop();
    result.limitations.push(
      "Finding descriptions were shortened to fit the report size limit.",
    );
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PAYLOAD_BYTES)
    fail("Sanitized run exceeds the upload size limit; upload skipped.");
  return result;
}

export function serializeState(state, repository) {
  if (!object(state) || !object(state.runs))
    fail("The bot state must contain a runs object.");
  const records = new Map();
  let skipped = 0;
  for (const run of Object.values(state.runs)) {
    if (
      !object(run) ||
      (repository && run.repository?.toLowerCase() !== repository.toLowerCase())
    )
      continue;
    const previous = Array.isArray(run.completionHistory)
      ? run.completionHistory.map((item) => item?.snapshot).filter(object)
      : [];
    for (const candidate of [...previous, run]) {
      if (
        repository &&
        candidate.repository?.toLowerCase() !== repository.toLowerCase()
      )
        continue;
      try {
        const record = serializeRun(candidate);
        records.set(record.recordId, record);
      } catch {
        skipped++;
      }
    }
  }
  return { records: [...records.values()], skipped };
}

export function validatePortalUrl(value, { allowHttpLoopback = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("QA_PORTAL_URL must be an HTTPS origin.");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== "/" ||
    !url.hostname
  )
    fail(
      "QA_PORTAL_URL must be an origin without credentials, path, query, or fragment.",
    );
  const literalLoopback =
    /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d{1,5})?\/?$/.test(value);
  if (url.protocol !== "https:" && !(allowHttpLoopback && literalLoopback))
    fail(
      "HTTPS is required; explicit --allow-http-loopback permits only literal loopback HTTP.",
    );
  return url.origin;
}

export class PortalClient {
  constructor({
    url,
    token,
    allowHttpLoopback = false,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15000,
  }) {
    this.origin = validatePortalUrl(url, { allowHttpLoopback });
    if (
      typeof token !== "string" ||
      token.length < 16 ||
      token.length > 512 ||
      /[^\x21-\x7e]/.test(token)
    )
      fail("QA_PORTAL_TOKEN is missing or invalid.");
    // Keep credentials non-enumerable to avoid accidental object serialization.
    Object.defineProperty(this, "token", { value: token });
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
  async request(method, endpoint, body) {
    if (
      !["/api/agent/config", "/api/agent/heartbeat"].includes(endpoint) &&
      !/^\/api\/agent\/runs\/[a-f0-9]{64}$/.test(endpoint)
    )
      fail("Unsupported portal endpoint.");
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized && Buffer.byteLength(serialized) > MAX_PAYLOAD_BYTES)
      fail("Portal request exceeds the size limit.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.origin}${endpoint}`, {
        method,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(serialized ? { "Content-Type": "application/json" } : {}),
        },
        body: serialized,
      });
      if (!response.ok)
        fail(`Portal request failed (HTTP ${Number(response.status) || 0}).`);
      if (Number(response.headers.get("content-length")) > MAX_PAYLOAD_BYTES)
        fail("Portal response exceeds the size limit.");
      const chunks = [];
      let bytes = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > MAX_PAYLOAD_BYTES) {
            controller.abort();
            fail("Portal response exceeds the size limit.");
          }
          chunks.push(Buffer.from(chunk));
        }
      }
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        fail("Portal returned invalid JSON.");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /^Portal (request failed \(HTTP \d+\)\.|response exceeds the size limit\.|returned invalid JSON\.)$/.test(
          error.message,
        )
      )
        throw error;
      fail(
        controller.signal.aborted
          ? "Portal request timed out."
          : "Portal request failed; check connectivity and the configured origin.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function validateRemoteConfig(value) {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    typeof value.projectId !== "string" ||
    !value.projectId ||
    value.projectId.length > 200 ||
    typeof value.repository !== "string" ||
    !REPOSITORY.test(value.repository) ||
    value.repository.length > 201
  )
    fail("Portal project configuration is invalid.");
  const s = value.settings;
  if (
    !object(s) ||
    Object.keys(s).some((key) => !SETTINGS.includes(key)) ||
    !BACKENDS.includes(s.backend) ||
    !modelId(s.model) ||
    !object(s.roleModels) ||
    Object.entries(s.roleModels).some(
      ([role, model]) => !ROLES.includes(role) || !modelId(model) || !model,
    ) ||
    !Array.isArray(s.roles) ||
    !s.roles.length ||
    s.roles.length > 5 ||
    new Set(s.roles).size !== s.roles.length ||
    s.roles.some((role) => !ROLES.includes(role)) ||
    !finite(s.maxCostUsd, 25) ||
    !Number.isSafeInteger(s.maxCallsPerRun) ||
    s.maxCallsPerRun < 1 ||
    s.maxCallsPerRun > 40 ||
    typeof s.allowImages !== "boolean"
  )
    fail("Portal model settings are invalid.");
  return {
    schemaVersion: 1,
    projectId: value.projectId,
    repository: value.repository,
    settings: Object.fromEntries(SETTINGS.map((key) => [key, s[key]])),
  };
}

/** @param {any} config @param {any} remote @param {{validateAIConfig?: Function, allowedBackends?: string[], allowImages?: boolean}} options */
export function mergeModelSettings(
  config,
  remote,
  { validateAIConfig, allowedBackends, allowImages = false } = {},
) {
  if (typeof validateAIConfig !== "function")
    fail("The bot AI settings validator is required.");
  let local;
  try {
    local = validateAIConfig(config.ai || {});
  } catch {
    fail("Local bot AI settings are invalid.");
  }
  const settings = validateRemoteConfig(remote).settings;
  const permitted = allowedBackends || [local.backend];
  if (!permitted.includes(settings.backend))
    fail(
      "Portal backend is not enrolled; use --allow-backends to opt in locally.",
    );
  if (settings.allowImages && !local.allowImages && !allowImages)
    fail(
      "Portal screenshot sharing is not enrolled; enable it locally or use --allow-images.",
    );
  const next = {
    ...local,
    ...settings,
    maxCostUsd: Math.min(settings.maxCostUsd, local.maxCostUsd),
    maxCallsPerRun: Math.min(settings.maxCallsPerRun, local.maxCallsPerRun),
  };
  try {
    return { ...config, ai: validateAIConfig(next) };
  } catch {
    fail(
      "Portal model selection is incompatible with the trusted bot settings or local profiles.",
    );
  }
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
async function trustedPath(root, requested, { missing = false } = {}) {
  const target = path.resolve(root, requested);
  const relative = path.relative(root, target);
  if (
    !inside(root, target) ||
    relative
      .split(path.sep)
      .some((part) => [".git", "node_modules"].includes(part))
  )
    fail("Agent paths must stay inside the trusted bot directory.");
  let actual;
  try {
    actual = await fs.realpath(target);
  } catch (error) {
    if (!missing || error.code !== "ENOENT")
      fail("A required bot file is unavailable.");
    let ancestor = path.dirname(target);
    while (true) {
      try {
        actual = path.join(
          await fs.realpath(ancestor),
          path.relative(ancestor, target),
        );
        break;
      } catch (failure) {
        if (failure.code !== "ENOENT" || ancestor === root)
          fail("Bot path cannot be resolved safely.");
        ancestor = path.dirname(ancestor);
      }
    }
  }
  if (!inside(root, actual))
    fail("Agent paths cannot resolve outside the trusted bot directory.");
  return target;
}
async function readJson(filename, maximum, { missing = false } = {}) {
  let handle;
  try {
    handle = await fs.open(filename, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum)
      fail("A bot JSON file is not a regular file or exceeds the size limit.");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maximum) fail("A bot JSON file exceeds the size limit.");
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      return { value: JSON.parse(raw), raw };
    } catch {
      fail("A bot JSON file is malformed.");
    }
  } catch (error) {
    if (missing && error.code === "ENOENT")
      return { value: { version: 1, runs: {} }, raw: "" };
    if (error instanceof Error && error.message.startsWith("A bot JSON file"))
      throw error;
    fail("A required bot JSON file could not be read.");
  } finally {
    await handle?.close();
  }
}

export async function loadBot(options) {
  if (!options.botDir)
    fail(
      "--bot-dir must identify your separate trusted qa-signoff-bot checkout.",
    );
  let botDir;
  try {
    botDir = await fs.realpath(options.botDir);
  } catch {
    fail("The bot directory is unavailable.");
  }
  const manifest = await readJson(
    await trustedPath(botDir, "package.json"),
    64 * 1024,
  );
  if (manifest.value.name !== "qa-signoff-bot")
    fail(
      "--bot-dir must be a trusted qa-signoff-bot checkout, not a product checkout.",
    );
  const configPath = await trustedPath(
    botDir,
    options.config || "qa-config.json",
  );
  if (path.extname(configPath) !== ".json")
    fail("The bot config must be a JSON file.");
  const statePath = await trustedPath(
    botDir,
    options.state || ".qa-local/state.json",
    { missing: true },
  );
  if (configPath === statePath)
    fail("Bot config and state must use separate files.");
  const config = await readJson(configPath, MAX_PAYLOAD_BYTES);
  const state = await readJson(statePath, MAX_STATE_BYTES, { missing: true });
  return {
    botDir,
    configPath,
    statePath,
    config: config.value,
    configRaw: config.raw,
    state: state.value,
  };
}

export function localInventory(config) {
  const seen = new Set();
  return (Array.isArray(config.ai?.local?.models) ? config.ai.local.models : [])
    .filter((profile) => {
      if (
        !object(profile) ||
        !modelId(profile.id) ||
        !profile.id ||
        seen.has(profile.id) ||
        !Number.isSafeInteger(profile.contextLength) ||
        profile.contextLength < 1024 ||
        profile.contextLength > 2000000 ||
        typeof profile.tools !== "boolean" ||
        typeof profile.vision !== "boolean"
      )
        return false;
      seen.add(profile.id);
      return true;
    })
    .slice(0, 100)
    .map((profile) => ({
      id: profile.id,
      name: profile.id,
      contextLength: profile.contextLength,
      tools: profile.tools,
      vision: profile.vision,
    }));
}

async function writeConfig(bot, next) {
  // Refuse a moved symlink or concurrent local edit instead of overwriting it.
  await trustedPath(bot.botDir, bot.configPath);
  const current = await readJson(bot.configPath, MAX_PAYLOAD_BYTES);
  if (current.raw !== bot.configRaw)
    fail("Bot config changed during sync; retry with the current settings.");
  const filename = `${bot.configPath}.${crypto.randomUUID()}.tmp`;
  const contents = `${JSON.stringify(next, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_PAYLOAD_BYTES)
    fail("Updated bot config would exceed the size limit.");
  try {
    await fs.writeFile(filename, contents, { flag: "wx", mode: 0o600 });
    await fs.rename(filename, bot.configPath);
  } catch {
    fail("Bot config could not be updated.");
  } finally {
    await fs.rm(filename, { force: true }).catch(() => {});
  }
}

/** @param {{options: Record<string, any>, env?: Record<string, string | undefined>, client?: {request: Function}, receipts?: Map<string, string>}} input */
export async function syncOnce({
  options,
  env = process.env,
  client,
  receipts = new Map(),
}) {
  const bot = await loadBot(options);
  if (options.dryRun) {
    const { records, skipped } = serializeState(bot.state);
    return {
      dryRun: true,
      runs: records.length,
      skipped,
      uploaded: 0,
      unchanged: 0,
      settingsApplied: false,
      localModels: localInventory(bot.config).length,
    };
  }
  const portal =
    client ||
    new PortalClient({
      url: env.QA_PORTAL_URL,
      token: env.QA_PORTAL_TOKEN,
      allowHttpLoopback: options.allowHttpLoopback,
    });
  const remote = validateRemoteConfig(
    await portal.request("GET", "/api/agent/config"),
  );
  let settingsApplied = false;
  if (options.applyModelSettings) {
    const modulePath = await trustedPath(bot.botDir, "src/ai/settings.js");
    let validateAIConfig;
    try {
      ({ validateAIConfig } = createRequire(import.meta.url)(modulePath));
    } catch {
      fail("The trusted bot AI settings validator could not be loaded.");
    }
    const next = mergeModelSettings(bot.config, remote, {
      validateAIConfig,
      allowedBackends: options.allowedBackends,
      allowImages: options.allowImages,
    });
    if (JSON.stringify(next.ai) !== JSON.stringify(bot.config.ai)) {
      await writeConfig(bot, next);
      settingsApplied = true;
    }
  }
  await portal.request("POST", "/api/agent/heartbeat", {
    models: localInventory(bot.config),
  });
  const { records, skipped } = serializeState(bot.state, remote.repository);
  let uploaded = 0,
    unchanged = 0;
  for (const record of records) {
    const digest = hash(JSON.stringify(record));
    const key = `${remote.projectId}:${record.recordId}`;
    if (receipts.get(key) === digest) {
      unchanged++;
      continue;
    }
    await portal.request("PUT", `/api/agent/runs/${record.recordId}`, record);
    receipts.set(key, digest);
    uploaded++;
  }
  return {
    dryRun: false,
    runs: records.length,
    skipped,
    uploaded,
    unchanged,
    settingsApplied,
    localModels: localInventory(bot.config).length,
  };
}

export function parseArgs(args) {
  const options = {};
  const flags = {
    "--apply-model-settings": "applyModelSettings",
    "--watch": "watch",
    "--allow-http-loopback": "allowHttpLoopback",
    "--allow-images": "allowImages",
    "--dry-run": "dryRun",
    "--help": "help",
  };
  const values = {
    "--bot-dir": "botDir",
    "--state": "state",
    "--config": "config",
    "--interval": "interval",
    "--allow-backends": "allowedBackends",
  };
  for (let i = 0; i < args.length; i++) {
    if (flags[args[i]]) options[flags[args[i]]] = true;
    else if (values[args[i]]) {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        fail("An agent option is missing its value.");
      options[values[args[i]]] = args[++i];
    } else fail("Unknown agent option; use --help.");
  }
  if (options.allowedBackends !== undefined) {
    options.allowedBackends = [...new Set(options.allowedBackends.split(","))];
    if (
      !options.allowedBackends.length ||
      options.allowedBackends.some((item) => !BACKENDS.includes(item))
    )
      fail("--allow-backends accepts openrouter,local.");
  }
  options.interval =
    options.interval === undefined ? 30 : Number(options.interval);
  if (
    !Number.isSafeInteger(options.interval) ||
    options.interval < 30 ||
    options.interval > 3600
  )
    fail("--interval must be 30 to 3600 seconds.");
  if (options.dryRun && options.watch)
    fail("--dry-run is a single offline preview and cannot use --watch.");
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(
      "Usage: node scripts/agent.mjs --bot-dir /path/to/qa-signoff-bot [--state .qa-local/state.json] [--config qa-config.json] [--watch] [--interval 30] [--apply-model-settings] [--allow-backends openrouter,local] [--allow-images] [--allow-http-loopback] [--dry-run]\nSet QA_PORTAL_URL and QA_PORTAL_TOKEN in the environment. Default sync never writes local files.",
    );
    return;
  }
  let stopped = false;
  let wake;
  const stop = () => {
    stopped = true;
    wake?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const receipts = new Map();
  try {
    do {
      try {
        console.log(JSON.stringify(await syncOnce({ options, receipts })));
      } catch (error) {
        console.error(
          `Agent sync failed: ${error instanceof Error ? error.message : "Unexpected connector error."}`,
        );
        if (!options.watch) {
          process.exitCode = 1;
          break;
        }
      }
      if (options.watch && !stopped)
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, options.interval * 1000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
    } while (options.watch && !stopped);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "Agent configuration is invalid; use --help and check the documented environment variables.",
    );
    process.exitCode = 1;
  });
}
