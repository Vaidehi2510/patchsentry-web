import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { prepareRunner, executeBridge, executionEnvironment, runClaimedJob, sanitizeJobReport } from '../scripts/runner.mjs';
import { readJson, trustedPath, sanitizeText, loadBot, syncOnce, parseArgs, PortalClient } from '../scripts/agent.mjs';
import { RunInputSchema } from '../src/lib/contracts';

const revision = 'a'.repeat(40);
function makeJob() { return { schemaVersion: 1, id: randomUUID(), repository: 'owner/product', pr: { number: 42 }, revision, base: 'main', settings: { backend: 'local', model: 'qa:8b', roles: ['planner'], roleModels: {}, maxCostUsd: 0, maxCallsPerRun: 4, allowImages: false }, testingProfile: { baseRef: 'main', previewUrlTemplate: 'https://preview.example', pages: ['/'], discoverPages: true, maxPages: 4, browsers: ['chromium'], allowMutations: false, visualRegression: false, goals: { schemaVersion: 1, allowSemanticMaintenance: false, goals: [] } } }; }
function makeReport(job: any) { return { schemaVersion: 1, recordId: 'c'.repeat(64), repository: job.repository, pr: { number: job.pr.number, title: 'Checkout review' }, revision: job.revision, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), phase: 'completed', checks: [{ id: 'ui', name: 'Checkout goal', method: 'automated', required: true, status: 'failed', details: 'The expected confirmation is absent.' }], findings: [], ai: { backend: 'local', model: 'qa:8b', costUsd: null, costIsEstimate: true, calls: 2 }, limitations: [] }; }
async function fixture(t: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'patchsentry-runner-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const botDir = path.join(root, 'bot'); await fs.mkdir(path.join(botDir, 'src/autonomy'), { recursive: true });
  await fs.writeFile(path.join(botDir, 'package.json'), '{"name":"qa-signoff-bot"}'); await fs.writeFile(path.join(botDir, 'qa-config.json'), JSON.stringify({ ai: { enabled: true, backend: 'local', local: { models: [] } } }));
  const policy = { schemaVersion: 1, repository: 'owner/product', repoCheckout: path.join(root, 'product'), base: 'main', allowedPreviewOrigins: ['https://preview.example'], allowedBrowsers: ['chromium'], allowedBackends: ['local'], maxPages: 4, maxGoals: 8, maxAssertions: 30, maxCostUsd: 1, maxCallsPerRun: 4, allowImages: false, allowMutations: false, timeoutMs: 2000 };
  await fs.mkdir(policy.repoCheckout); await fs.writeFile(path.join(policy.repoCheckout, 'unchanged.txt'), 'product source');
  await fs.writeFile(path.join(botDir, 'portal-policy.json'), JSON.stringify(policy));
  await fs.writeFile(path.join(botDir, 'src/autonomy/portal.js'), `const fs=require('node:fs/promises'),path=require('node:path');
module.exports.validatePortalPolicy=p=>{if(p.schemaVersion!==1)throw new Error('Invalid policy');return p};
module.exports.preflightPortal=async({policy})=>({ready:true,missing:[],capabilities:{browsers:policy.allowedBrowsers,backends:policy.allowedBackends}});
module.exports.validateJob=(j,p)=>{if(j.repository!==p.repository||j.settings.maxCostUsd>p.maxCostUsd||j.settings.maxCallsPerRun>p.maxCallsPerRun||!p.allowedBackends.includes(j.settings.backend)||j.testingProfile.browsers.some(b=>!p.allowedBrowsers.includes(b))||!p.allowedPreviewOrigins.includes(new URL(j.testingProfile.previewUrlTemplate).origin))throw new Error('outside policy');return j};
if(require.main===module)(async()=>{const a=Object.fromEntries(process.argv.slice(2).reduce((v,k,i,all)=>i%2?v:[...v,[k,all[i+1]]],[]));const j=JSON.parse(await fs.readFile(a['--job'],'utf8'));if(process.env.QA_PORTAL_TOKEN||process.env.DATABASE_URL||process.env.GITHUB_TOKEN||process.env.BETTER_AUTH_SECRET||process.env.NODE_OPTIONS)process.exit(11);await fs.mkdir(a['--output-dir'],{recursive:true});await fs.appendFile(path.join(a['--output-dir'],'executions.txt'),'run\\n');const report=(${makeReport.toString()})(j);await fs.writeFile(path.join(a['--output-dir'],'portal-run.json'),JSON.stringify(report));})().catch(()=>process.exit(1));`);
  const options = { botDir, executeJobs: true, runnerPolicy: 'portal-policy.json' };
  const bot: any = await loadBot(options);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, QA_PORTAL_TOKEN: 'pst_secret', DATABASE_URL: 'postgresql://private', BETTER_AUTH_SECRET: 'secret', GITHUB_TOKEN: 'github-secret', OPENROUTER_API_KEY: 'inference-key', LOCAL_MODEL_API_KEY: 'local-key', NODE_OPTIONS: '--require evil' };
  const runner = await prepareRunner({ bot, options, env, repository: 'owner/product', readJson, trustedPath, sanitizeText });
  return { root, bot, options, env, runner, policy };
}
function portal(job: any) {
  const calls: any[] = []; let claimed = false;
  return { calls, request: async (method: string, endpoint: string, body?: any) => { calls.push({ method, endpoint, body }); if (endpoint.endsWith('/claim')) { if (claimed) return { job: null }; claimed = true; return { job, leaseToken: 's'.repeat(43) }; } return { ok: true }; } };
}
function args(f: any, p: any): any { return { runner: f.runner, bot: f.bot, portal: p, models: [], env: f.env, readJson, trustedPath, sanitizeText, signal: undefined }; }

test('default sync is not enrolled and preflight reports missing setup without making model/browser calls', async t => {
  const f = await fixture(t);
  const notEnrolled = await prepareRunner({ bot: f.bot, options: { botDir: f.bot.botDir }, env: {}, repository: 'owner/product', readJson, trustedPath, sanitizeText });
  assert.equal(notEnrolled.heartbeat.ready, false); assert.equal(notEnrolled.heartbeat.executeJobs, false);
  assert.equal(f.runner.heartbeat.ready, true);
  const wrong = await prepareRunner({ bot: f.bot, options: f.options, env: f.env, repository: 'other/product', readJson, trustedPath, sanitizeText });
  assert.equal(wrong.heartbeat.ready, false); assert.match(wrong.heartbeat.missing.join(' '), /differs/);
  const local = await syncOnce({ options: { ...f.options, checkRunner: true }, env: f.env, client: { request: async () => assert.fail('Preflight contacted portal') } });
  assert.equal(local.preflight, true);
  assert.equal(parseArgs(['--execute-jobs', '--runner-policy', 'portal-policy.json']).executeJobs, true);
});

test('actual fixed bridge process runs, preserves failed QA, uploads before ACK and cannot access portal/hosting/GitHub secrets', async t => {
  const f = await fixture(t), job = makeJob(), p = portal(job);
  const result = await runClaimedJob(args(f, p));
  assert.equal(result.status, 'completed');
  const put = p.calls.find(c => c.method === 'PUT'); const report = RunInputSchema.parse(put.body);
  assert.equal(report.checks[0].status, 'failed');
  assert.ok(p.calls.indexOf(put) < p.calls.findIndex(c => c.endpoint.endsWith('/complete')));
  assert.equal(p.calls.at(-1).body.status, 'completed');
  assert.equal(await fs.readFile(path.join(f.policy.repoCheckout, 'unchanged.txt'), 'utf8'), 'product source');
  const output = path.join(f.bot.botDir, '.qa-local/portal-jobs', job.id, 'output');
  assert.equal(await fs.readFile(path.join(output, 'executions.txt'), 'utf8'), 'run\n');
  assert.ok(!(await fs.readFile(path.join(output, 'portal-run.json'), 'utf8')).includes('inference-key'));
});

test('retry reuses a completed local report instead of invoking a second model/browser execution', async t => {
  const f = await fixture(t), job = makeJob();
  assert.equal((await runClaimedJob(args(f, portal(job)))).status, 'completed');
  const retry = await runClaimedJob({ ...args(f, portal(job)), execute: async () => assert.fail('Retried completed execution') });
  assert.equal(retry.status, 'completed'); assert.equal(retry.resumedReport, true);
  const changed = { ...job, pr: { number: 43 } };
  const invalid = await runClaimedJob({ ...args(f, portal(changed)), execute: async () => assert.fail('Changed immutable job executed') });
  assert.equal(invalid.status, 'blocked');
});

test('local origin, repository, browser and model budget limits block jobs before spawn or file creation', async t => {
  const f = await fixture(t);
  for (const change of [{ repository: 'evil/product' }, { settings: { ...makeJob().settings, maxCostUsd: 2 } }, { testingProfile: { ...makeJob().testingProfile, browsers: ['webkit'] } }, { testingProfile: { ...makeJob().testingProfile, previewUrlTemplate: 'https://evil.test' } }]) {
    const job = { ...makeJob(), ...change }, p = portal(job);
    assert.equal((await runClaimedJob({ ...args(f, p), execute: async () => assert.fail('Out-of-policy process started') })).status, 'blocked');
    assert.equal(p.calls.at(-1).body.status, 'blocked');
  }
  await assert.rejects(fs.stat(path.join(f.bot.botDir, '.qa-local/portal-jobs')), { code: 'ENOENT' });
});

test('lease loss aborts active execution and does not claim a completed result', async t => {
  const f = await fixture(t), p = portal(makeJob()); let aborted = false;
  const baseRequest = p.request; p.request = async (method, endpoint, body) => { if (endpoint.endsWith('/lease')) throw new Error('Lease revoked'); return baseRequest(method, endpoint, body); };
  const execute = async ({ signal }: any) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('Stopped')); }, { once: true }));
  assert.equal((await runClaimedJob({ ...args(f, p), execute, renewMs: 5 })).status, 'blocked');
  assert.equal(aborted, true); assert.ok(!p.calls.some(c => c.method === 'PUT'));
});

test('fixed argument vector excludes arbitrary shell syntax and child environment is allowlisted', async () => {
  let captured: any;
  const fake = (_cmd: any, _args: any, options: any) => { captured = { cmd: _cmd, args: _args, options }; const child = new EventEmitter() as any; child.pid = 123456; child.kill = () => {}; queueMicrotask(() => child.emit('close', 0)); return child; };
  await executeBridge({ bridgePath: '/bot/src/autonomy/portal.js', jobFile: '/bot/job;echo-secret.json', policyPath: '/bot/policy.json', outputDir: '/bot/output', botDir: '/bot', env: { PATH: '/usr/bin', OPENROUTER_API_KEY: 'model-secret', QA_PORTAL_TOKEN: 'portal-secret', DATABASE_URL: 'private-db', NODE_OPTIONS: '--eval danger' }, timeoutMs: 1000, signal: undefined, spawnImpl: fake as any });
  assert.equal(captured.cmd, process.execPath); assert.equal(captured.options.shell, false); assert.deepEqual(captured.args, ['/bot/src/autonomy/portal.js', '--job', '/bot/job;echo-secret.json', '--policy', '/bot/policy.json', '--output-dir', '/bot/output']);
  assert.deepEqual(captured.options.env, { PATH: '/usr/bin', OPENROUTER_API_KEY: 'model-secret' });
  assert.deepEqual(executionEnvironment({ GITHUB_TOKEN: 'x', QA_PORTAL_TOKEN: 'y' }), {});
});

test('mismatched, malformed and symlinked reports are blocked and report text excludes raw source and secrets', async t => {
  const f = await fixture(t), job = makeJob();
  const raw: any = makeReport(job); raw.transcript = 'private transcript'; raw.checks[0].details = '```js\nprivate-source\n``` password=private-password'; raw.findings = [{ title: 'Risk', severity: 'high', category: 'bug', description: '`private-inline`', status: 'verified' }];
  const safe = sanitizeJobReport(raw, job, sanitizeText); assert.doesNotMatch(JSON.stringify(safe), /private-source|private-password|private-inline|private transcript/); assert.equal(safe.findings[0].status, 'unverified');
  assert.throws(() => sanitizeJobReport({ ...raw, revision: 'b'.repeat(40) }, job, sanitizeText), /exact job/);
  const p = portal(job);
  const execute = async ({ outputDir }: any) => { await fs.mkdir(outputDir, { recursive: true }); await fs.symlink(path.join(f.bot.botDir, 'qa-config.json'), path.join(outputDir, 'portal-run.json')); };
  assert.equal((await runClaimedJob({ ...args(f, p), execute })).status, 'blocked');
  assert.ok(!p.calls.some(c => c.method === 'PUT'));
});

test('execution dry-run launches no job, loads no bridge and writes no job directory', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.bot.botDir, 'src/autonomy/portal.js'), 'throw new Error("must not load");');
  const result = await syncOnce({ options: { ...f.options, dryRun: true }, env: f.env, client: { request: async () => assert.fail('Dry run requested a job') } });
  assert.equal(result.dryRun, true); await assert.rejects(fs.stat(path.join(f.bot.botDir, '.qa-local/portal-jobs')), { code: 'ENOENT' });
});

test('authenticated website job flows through the real connector and process back to a failed report and completed lease', { timeout: 30000 }, async t => {
  const [{ createPGliteDatabase }, { createAuth, migrateDatabase }, { handleRequest }, { TestingProfileSchema }] = await Promise.all([
    import('../src/lib/server/database'), import('../src/lib/server/auth'), import('../src/lib/server/api'), import('../src/lib/jobs'),
  ]);
  const f = await fixture(t);
  await fs.writeFile(f.bot.configPath, JSON.stringify({ ai: { enabled: true, backend: 'local', local: { models: [{ id: 'qa:8b', contextLength: 8192, tools: true, vision: false }] } } }));
  const database = await createPGliteDatabase(); t.after(() => database.end());
  const config = { origin: 'https://portal.example', secret: 'runner-integration-only-secret-at-least-32-characters', production: false };
  await migrateDatabase(database, config); const runtime = { database, config, auth: createAuth(database, config) };
  const request = (endpoint: string, method: string, body?: unknown, cookie?: string) => handleRequest(new Request(config.origin + endpoint, { method, headers: { origin: config.origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), runtime);
  const signup = await request('/api/auth/sign-up/email', 'POST', { name: 'Runner owner', email: 'runner@example.test', password: 'Runner-integration-fixture-password-123' }); assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const created = await request('/api/projects', 'POST', { name: 'Runner integration', repository: 'owner/product' }, cookie); const project = (await created.json()).project;
  const issued = await request(`/api/projects/${project.id}/token`, 'POST', {}, cookie); const token = (await issued.json()).token;
  const client = new PortalClient({ url: config.origin, token, fetchImpl: async (url: any, init: any) => handleRequest(new Request(url, init), runtime) });
  const env = { ...f.env, QA_PORTAL_TOKEN: token };
  const first = await syncOnce({ options: f.options, env, client }); assert.ok('job' in first); assert.equal(first.job?.status, 'idle');
  const job = makeJob(); job.testingProfile.goals.goals = [{ id: 'checkout', name: 'Checkout confirmation', start: '/', requirement: 'Checkout confirms the order.', inputs: {}, assertions: [{ id: 'confirmation', action: 'expectText', selector: 'body', text: 'Order confirmed', exact: false }] }] as any;
  const setup = await request(`/api/projects/${project.id}`, 'PATCH', { testingProfile: TestingProfileSchema.parse(job.testingProfile), settings: job.settings }, cookie); assert.equal(setup.status, 200);
  const queued = await request(`/api/projects/${project.id}/jobs`, 'POST', { prNumber: 42, revision, dedupeKey: randomUUID() }, cookie); assert.equal(queued.status, 201); const id = (await queued.json()).job.id;
  const result = await syncOnce({ options: f.options, env, client }); assert.ok('job' in result); assert.equal(result.job?.status, 'completed');
  const saved = await database.query<{ status: string; record_id: string }>('SELECT status,record_id FROM qa_jobs WHERE id=$1', [id]); assert.equal(saved.rows[0].status, 'completed');
  const report = await database.query<{ payload: { score: { status: string; score: number } } }>('SELECT payload FROM qa_runs WHERE record_id=$1', [saved.rows[0].record_id]); assert.equal(report.rows[0].payload.score.status, 'failed'); assert.equal(report.rows[0].payload.score.score, 0);
  const again = await syncOnce({ options: f.options, env, client }); assert.ok('job' in again); assert.equal(again.job?.status, 'idle');
  assert.equal(await fs.readFile(path.join(f.policy.repoCheckout, 'unchanged.txt'), 'utf8'), 'product source');
});
