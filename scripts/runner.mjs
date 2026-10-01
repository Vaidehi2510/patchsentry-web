import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const MAX = 256 * 1024;
const environmentKeys = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'OPENROUTER_API_KEY', 'LOCAL_MODEL_API_KEY', 'PLAYWRIGHT_BROWSERS_PATH', 'QA_BROWSER_EXECUTABLE', 'QA_CHROMIUM_EXECUTABLE', 'QA_FIREFOX_EXECUTABLE', 'QA_WEBKIT_EXECUTABLE', 'QA_NATIVE_ENABLED', 'QA_NATIVE_DEVICE_ID'];
export function executionEnvironment(env) { return Object.fromEntries(environmentKeys.filter(key => typeof env[key] === 'string').map(key => [key, env[key]])); }

/** Readiness never contacts a model, preview, or GitHub service. */
export async function prepareRunner({ bot, options, env, repository, readJson, trustedPath, sanitizeText }) {
  const policyFile = options.runnerPolicy || 'portal-policy.json';
  const heartbeat = { id: sha(`${bot.botDir}\n${policyFile}`), executeJobs: Boolean(options.executeJobs), ready: false,
    missing: [], browsers: [], backends: [], maxPages: 0, maxCostUsd: 0, maxCallsPerRun: 0 };
  if (!options.executeJobs && !options.checkRunner) {
    heartbeat.missing.push('Execution is not enrolled. Start the connector with --execute-jobs --runner-policy portal-policy.json.');
    return { heartbeat };
  }
  try {
    const policyPath = await trustedPath(bot.botDir, policyFile);
    const raw = (await readJson(policyPath, MAX)).value;
    const bridgePath = await trustedPath(bot.botDir, 'src/autonomy/portal.js');
    const bridge = createRequire(import.meta.url)(bridgePath);
    if (typeof bridge.validatePortalPolicy !== 'function' || typeof bridge.preflightPortal !== 'function' || typeof bridge.validateJob !== 'function') throw new Error('Update the QA bot to a version with the reviewed portal execution bridge.');
    const policy = bridge.validatePortalPolicy(raw, { policyPath, botDir: bot.botDir });
    const preflight = await bridge.preflightPortal({ policy: raw, policyPath, botDir: bot.botDir, env: executionEnvironment(env) });
    if (repository && policy.repository.toLowerCase() !== repository.toLowerCase()) heartbeat.missing.push('The local policy repository differs from the portal project.');
    heartbeat.missing.push(...(Array.isArray(preflight.missing) ? preflight.missing : ['Runner preflight did not provide a result.']).map(value => sanitizeText(value, 240)).slice(0, 19));
    heartbeat.browsers = policy.allowedBrowsers;
    heartbeat.backends = policy.allowedBackends;
    heartbeat.maxPages = policy.maxPages; heartbeat.maxCostUsd = policy.maxCostUsd; heartbeat.maxCallsPerRun = policy.maxCallsPerRun;
    if (!options.executeJobs) heartbeat.missing.push('Execution is not enrolled. Add --execute-jobs to explicitly enroll this runner.');
    heartbeat.ready = Boolean(options.executeJobs && preflight.ready && !heartbeat.missing.length);
    return { heartbeat, policy, policyPath, bridgePath, bridge };
  } catch {
    heartbeat.missing.push('Runner policy or reviewed bot bridge is unavailable or invalid. Run the bot preflight locally and check portal-policy.json.');
    return { heartbeat };
  }
}

function terminate(child, signal = 'SIGTERM') {
  try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { /* process already exited */ }
}
export function executeBridge({ bridgePath, jobFile, policyPath, outputDir, botDir, env, timeoutMs, signal, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Runner execution was cancelled.')); return; }
    const child = spawnImpl(process.execPath, [bridgePath, '--job', jobFile, '--policy', policyPath, '--output-dir', outputDir], {
      cwd: botDir, env: executionEnvironment(env), shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'],
    });
    let reason = ''; let killTimer;
    const stop = message => { if (reason) return; reason = message; terminate(child); killTimer = setTimeout(() => terminate(child, 'SIGKILL'), 3000); killTimer.unref?.(); };
    const abort = () => stop('Runner execution was cancelled or its lease was lost.');
    const timer = setTimeout(() => stop('The enrolled runner deadline was exceeded.'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    child.once('error', () => { cleanup(); reject(new Error('The reviewed QA command could not start.')); });
    child.once('close', code => { cleanup(); if (reason || code !== 0) reject(new Error(reason || 'The reviewed QA command stopped without a completed report. Inspect local runner evidence.')); else resolve(undefined); });
  });
}

/** Do not upload arbitrary bridge JSON: rebuild the exact summary allowlist. */
export function sanitizeJobReport(raw, job, clean) {
  if (!object(raw) || raw.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(raw.recordId || '') || raw.repository !== job.repository || raw.revision !== job.revision || raw.pr?.number !== job.pr.number) throw new Error('The runner report does not match this exact job.');
  if (!Array.isArray(raw.checks) || raw.checks.length > 200 || !Array.isArray(raw.findings) || raw.findings.length > 100) throw new Error('The runner report exceeds the complete-check or finding limit.');
  const checks = raw.checks.map(check => {
    const method = ['automated', 'analysis', 'human', 'unsupported'].includes(check.method) ? check.method : 'unsupported';
    const status = ['passed', 'failed', 'blocked', 'skipped', 'pending', 'running', 'execution_error', 'awaiting_human', 'unsupported'].includes(check.status) ? check.status : 'blocked';
    return { id: clean(check.id, 160), name: clean(check.name, 240), method, required: check.required !== false, status: method === 'unsupported' && status === 'passed' ? 'blocked' : status, ...(typeof check.details === 'string' ? { details: clean(check.details, 1200) } : {}) };
  });
  if (checks.some(c => !c.id) || new Set(checks.map(c => c.id)).size !== checks.length) throw new Error('The runner report has invalid or duplicate checks.');
  const findings = raw.findings.map(f => ({ title: clean(f.title, 240) || 'Untitled finding', severity: ['critical', 'high', 'medium', 'low', 'info'].includes(f.severity) ? f.severity : 'info', category: clean(f.category, 80), description: clean(f.description, 1600), ...(typeof f.suggestedFix === 'string' ? { suggestedFix: clean(f.suggestedFix, 1600) } : {}), status: 'unverified' }));
  if (!Number.isFinite(Date.parse(raw.createdAt)) || raw.completedAt && !Number.isFinite(Date.parse(raw.completedAt))) throw new Error('The runner report has invalid timestamps.');
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000;
  const report = { schemaVersion: 1, recordId: raw.recordId, repository: job.repository, pr: { number: job.pr.number, title: clean(raw.pr.title, 300) }, revision: job.revision,
    createdAt: new Date(raw.createdAt).toISOString(), completedAt: raw.completedAt ? new Date(raw.completedAt).toISOString() : null, phase: clean(raw.phase, 80), checks, findings,
    ai: { backend: ['openrouter', 'local'].includes(raw.ai?.backend) ? raw.ai.backend : 'unknown', model: clean(raw.ai?.model, 160), costUsd: finite(raw.ai?.costUsd) ? raw.ai.costUsd : null, costIsEstimate: raw.ai?.costIsEstimate !== false, calls: Number.isInteger(raw.ai?.calls) && finite(raw.ai.calls) ? raw.ai.calls : 0 },
    limitations: (Array.isArray(raw.limitations) ? raw.limitations : []).slice(0, 29).map(value => clean(value, 600)).concat('Sanitized summaries may contain product information; source files, screenshots and raw evidence remain on the runner.') };
  if (Buffer.byteLength(JSON.stringify(report)) > MAX - 4096) throw new Error('The sanitized runner report exceeds the upload size limit.');
  return report;
}

export async function runClaimedJob({ runner, bot, portal, models, env, readJson, trustedPath, sanitizeText, signal, execute = executeBridge, renewMs = 30000 }) {
  if (!runner.heartbeat.ready) return { status: 'not-ready' };
  const claim = await portal.request('POST', '/api/agent/jobs/claim', { runnerId: runner.heartbeat.id });
  if (!claim?.job) return { status: 'idle' };
  const job = claim.job;
  if (!/^[a-f0-9-]{36}$/.test(job.id || '') || !/^[A-Za-z0-9_-]{43}$/.test(claim.leaseToken || '')) throw new Error('Portal returned an invalid execution lease.');
  const lease = { runnerId: runner.heartbeat.id, leaseToken: claim.leaseToken };
  const ack = (status, message = '', recordId) => portal.request('POST', `/api/agent/jobs/${job.id}/complete`, { ...lease, status, message, ...(recordId ? { recordId } : {}) });
  try { runner.bridge.validateJob(job, runner.policy); }
  catch { await ack('blocked', 'Job exceeds the locally enrolled repository, preview, browser, model, mutation or budget policy. Update the local policy deliberately or request a compatible run.'); return { status: 'blocked', id: job.id }; }
  const abort = new AbortController();
  const stopped = () => abort.abort(); signal?.addEventListener('abort', stopped, { once: true });
  if (signal?.aborted) abort.abort();
  let renewal; let leaseLost = false;
  const renew = async () => {
    try { await portal.request('POST', `/api/agent/jobs/${job.id}/lease`, lease); await portal.request('POST', '/api/agent/heartbeat', { models, runner: runner.heartbeat }); }
    catch { leaseLost = true; abort.abort(); }
  };
  const timer = setInterval(() => { if (!renewal) renewal = renew().finally(() => { renewal = undefined; }); }, renewMs);
  try {
    const jobDir = await trustedPath(bot.botDir, `.qa-local/portal-jobs/${job.id}`, { missing: true });
    await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
    const jobFile = await trustedPath(bot.botDir, path.join(jobDir, 'job.json'), { missing: true });
    const contents = JSON.stringify(job);
    try { await fs.writeFile(jobFile, contents, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST' || (await readJson(jobFile, MAX)).raw !== contents) throw new Error('Saved job identity changed; execution blocked.'); }
    const outputDir = await trustedPath(bot.botDir, path.join(jobDir, 'output'), { missing: true });
    const reportFile = await trustedPath(bot.botDir, path.join(outputDir, 'portal-run.json'), { missing: true });
    let exists = false;
    try { const stat = await fs.lstat(reportFile); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe runner report file.'); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) await execute({ bridgePath: runner.bridgePath, jobFile, policyPath: runner.policyPath, outputDir, botDir: bot.botDir, env, timeoutMs: runner.policy.timeoutMs, signal: abort.signal });
    if (abort.signal.aborted) throw new Error('Execution lease was lost or cancelled.');
    await trustedPath(bot.botDir, reportFile);
    const stat = await fs.lstat(reportFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe runner report file.');
    const report = sanitizeJobReport((await readJson(reportFile, MAX)).value, job, sanitizeText);
    await portal.request('PUT', `/api/agent/runs/${report.recordId}`, report);
    await ack('completed', 'The reviewed runner finished. Check outcomes determine the QA result.', report.recordId);
    return { status: 'completed', id: job.id, recordId: report.recordId, resumedReport: exists };
  } catch {
    if (!leaseLost) await ack('blocked', 'The runner did not produce and upload a valid complete report. Inspect local prerequisites/evidence before explicitly retrying.').catch(() => {});
    return { status: 'blocked', id: job.id };
  } finally { clearInterval(timer); signal?.removeEventListener('abort', stopped); if (renewal) await renewal; }
}
