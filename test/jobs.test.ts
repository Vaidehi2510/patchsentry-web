import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPGliteDatabase } from '../src/lib/server/database';
import { createAuth, migrateDatabase } from '../src/lib/server/auth';
import { handleRequest } from '../src/lib/server/api';
import type { Runtime } from '../src/lib/server/runtime';
import { TestingProfileSchema, JobInputSchema, runnerOnline } from '../src/lib/jobs';
import { settingsDefaults } from '../src/lib/contracts';

const config = { secret: 'job-tests-only-secret-with-at-least-32-characters', origin: 'https://portal.example', production: false };
let runtime: Runtime, directory: string, alice: string, bob: string;
const runner = { id: 'b'.repeat(64), executeJobs: true, ready: true, missing: [], browsers: ['chromium'], backends: ['local'], maxPages: 4, maxCostUsd: 2, maxCallsPerRun: 20 };
const profile = TestingProfileSchema.parse({ previewUrlTemplate: 'https://pr-{pr}.example.test', goals: { schemaVersion: 1, goals: [
  { id: 'signup', name: 'Create an account', start: '/', requirement: 'A synthetic new user sees a welcome confirmation.', inputs: { email: 'qa@example.test' }, assertions: [{ id: 'welcome', action: 'expectText', selector: 'body', text: 'Welcome' }] },
] } });
async function call(endpoint: string, method = 'GET', body?: unknown, cookie?: string, token?: string) {
  return handleRequest(new Request(config.origin + endpoint, { method, headers: { origin: config.origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), runtime);
}
async function signup(name: string) { const result = await call('/api/auth/sign-up/email', 'POST', { name, email: `${name}@example.test`, password: 'Fixture-user-password-only-12345' }); assert.equal(result.status, 200); return result.headers.getSetCookie().map(v => v.split(';')[0]).join('; '); }
async function project(ready = true) {
  const created = await call('/api/projects', 'POST', { name: 'Test project', repository: `owner/product-${randomUUID()}` }, alice);
  const value = (await created.json()).project; assert.ok(value.id);
  const issued = await call(`/api/projects/${value.id}/token`, 'POST', {}, alice); const token = (await issued.json()).token;
  if (ready) {
    assert.equal((await call(`/api/projects/${value.id}`, 'PATCH', { testingProfile: profile }, alice)).status, 200);
    assert.equal((await call('/api/agent/heartbeat', 'POST', { models: [{ id: 'qa:8b', name: 'QA', contextLength: 8192, tools: true, vision: false }], runner }, undefined, token)).status, 200);
    assert.equal((await call(`/api/projects/${value.id}`, 'PATCH', { settings: { ...settingsDefaults, backend: 'local', model: 'qa:8b' } }, alice)).status, 200);
  }
  return { ...value, token };
}
const input = () => ({ prNumber: 42, revision: 'a'.repeat(40), dedupeKey: randomUUID() });
async function queue(p: any, body = input()) { const response = await call(`/api/projects/${p.id}/jobs`, 'POST', body, alice); assert.equal(response.status, 201, JSON.stringify(await response.clone().json())); return (await response.json()).job; }
async function claim(p: any) { const response = await call('/api/agent/jobs/claim', 'POST', { runnerId: runner.id }, undefined, p.token); assert.equal(response.status, 200); return response.json(); }
function lease(c: any) { return { runnerId: runner.id, leaseToken: c.leaseToken }; }
before(async () => { directory = await mkdtemp(join(tmpdir(), 'patchsentry-jobs-')); const database = await createPGliteDatabase(directory); await migrateDatabase(database, config); runtime = { database, config, auth: createAuth(database, config) }; alice = await signup('alice-jobs'); bob = await signup('bob-jobs'); });
after(async () => { await runtime?.database.end(); await rm(directory, { recursive: true, force: true }); });

test('testing profiles reject commands, external path escapes, incomplete assertions and unbounded discovery', () => {
  for (const update of [{ command: 'curl evil' }, { maxPages: 9 }, { pages: ['//evil.test'] }, { pages: ['/%2e%2e/private'] }, { previewUrlTemplate: 'https://user:secret@example.test' }, { browsers: ['chromium', 'chromium'] }]) assert.equal(TestingProfileSchema.safeParse({ ...profile, ...update }).success, false);
  assert.equal(TestingProfileSchema.safeParse({ ...profile, goals: { schemaVersion: 1, goals: [{ ...profile.goals.goals[0], assertions: [{ id: 'missing', action: 'expectText', selector: 'body' }] }] } }).success, false);
  assert.equal(profile.allowMutations, false); assert.equal(profile.visualRegression, false); assert.equal(profile.goals.allowSemanticMaintenance, false);
  assert.equal(TestingProfileSchema.safeParse({ ...profile, goals: { ...profile.goals, goals: [{ ...profile.goals.goals[0], assertions: Array.from({ length: 9 }, (_, i) => ({ id: `assertion-${i}`, action: 'expectVisible', selector: 'body' })) }] } }).success, false);
  assert.equal(TestingProfileSchema.safeParse({ ...profile, goals: { ...profile.goals, goals: [{ ...profile.goals.goals[0], assertions: [{ id: 'mixed', action: 'expectUrl', path: '/', selector: 'body' }] }] } }).success, false);
  assert.equal(runnerOnline(new Date(Date.now() - 100_000).toISOString()), false);
});

test('unconfigured or offline requests are durably blocked and never claimable', async () => {
  const p = await project(false); const job = await queue(p);
  assert.equal(job.status, 'blocked'); assert.match(job.message, /preview URL/);
  assert.equal((await call('/api/agent/jobs/claim', 'POST', { runnerId: runner.id }, undefined, p.token)).status, 409);
  const listed = await call(`/api/projects/${p.id}/jobs`, 'GET', undefined, alice);
  assert.equal((await listed.json()).jobs[0].id, job.id);
  assert.equal((await call(`/api/projects/${p.id}/jobs/${job.id}/retry`, 'POST', {}, alice)).status, 409);
});

test('owner scopes protect job configuration, requests and lists; account cookies cannot claim runner jobs', async () => {
  const p = await project();
  for (const [endpoint, method, body] of [[`/api/projects/${p.id}/jobs`, 'GET', undefined], [`/api/projects/${p.id}/jobs`, 'POST', input()], [`/api/projects/${p.id}`, 'PATCH', { testingProfile: profile }]] as const) assert.equal((await call(endpoint, method, body, bob)).status, 404);
  assert.equal((await call(`/api/projects/${p.id}/jobs`, 'POST', input(), undefined, p.token)).status, 401);
  assert.equal((await call('/api/agent/jobs/claim', 'POST', { runnerId: runner.id }, alice)).status, 401);
  assert.equal((await call(`/api/projects/${p.id}/jobs`, 'POST', { ...input(), revision: 'main' }, alice)).status, 400);
  assert.equal((await call(`/api/projects/${p.id}/jobs`, 'POST', { ...input(), repository: 'evil/repo' }, alice)).status, 400);
});

test('concurrent claims lease one immutable exact-SHA job, hide lease secrets, and require a matching report before ACK', async () => {
  const p = await project(); const job = await queue(p);
  const claims = await Promise.all([claim(p), claim(p)]); assert.equal(claims.filter(v => v.job).length, 1);
  const claimed = claims.find(v => v.job); JobInputSchema.parse(claimed.job);
  assert.equal(claimed.job.id, job.id); assert.equal(claimed.job.repository, p.repository); assert.equal(claimed.job.revision, 'a'.repeat(40));
  const stored = await runtime.database.query<{ lease_hash: string }>('SELECT lease_hash FROM qa_jobs WHERE id=$1', [job.id]);
  assert.equal(stored.rows[0].lease_hash.length, 64); assert.notEqual(stored.rows[0].lease_hash, claimed.leaseToken);
  const list = await call(`/api/projects/${p.id}/jobs`, 'GET', undefined, alice); const serialized = JSON.stringify(await list.json());
  assert.ok(!serialized.includes(claimed.leaseToken)); assert.ok(!serialized.includes('lease_hash'));
  const complete = { ...lease(claimed), status: 'completed', recordId: 'c'.repeat(64) };
  assert.equal((await call(`/api/agent/jobs/${job.id}/complete`, 'POST', complete, undefined, p.token)).status, 409);
  const report = { schemaVersion: 1, recordId: complete.recordId, repository: p.repository, pr: { number: 42, title: 'Failure remains failure' }, revision: 'a'.repeat(40), createdAt: new Date().toISOString(), phase: 'completed', checks: [{ id: 'ui', name: 'UI check', method: 'automated', required: true, status: 'failed' }], findings: [], ai: { backend: 'local', model: 'qa:8b', costUsd: 0, costIsEstimate: false, calls: 1 }, limitations: [] };
  assert.equal((await call(`/api/agent/runs/${complete.recordId}`, 'PUT', report, undefined, p.token)).status, 200);
  assert.equal((await call(`/api/agent/jobs/${job.id}/complete`, 'POST', complete, undefined, p.token)).status, 200);
  const again = await call(`/api/agent/jobs/${job.id}/complete`, 'POST', complete, undefined, p.token); assert.equal((await again.json()).duplicate, true);
  const runs = await call(`/api/projects/${p.id}/runs`, 'GET', undefined, alice); assert.equal((await runs.json()).runs[0].score.status, 'failed');
});

test('leases cannot cross projects or runners and cancellation invalidates an active lease', async () => {
  const p = await project(), other = await project(); const job = await queue(p); const c = await claim(p);
  assert.equal((await call(`/api/agent/jobs/${job.id}/lease`, 'POST', lease(c), undefined, other.token)).status, 404);
  assert.equal((await call(`/api/agent/jobs/${job.id}/lease`, 'POST', { ...lease(c), runnerId: 'f'.repeat(64) }, undefined, p.token)).status, 409);
  assert.equal((await call(`/api/agent/jobs/${job.id}/lease`, 'POST', lease(c), undefined, p.token)).status, 200);
  assert.equal((await call(`/api/projects/${p.id}/jobs/${job.id}/cancel`, 'POST', {}, bob)).status, 404);
  assert.equal((await call(`/api/projects/${p.id}/jobs/${job.id}/cancel`, 'POST', {}, alice)).status, 200);
  assert.equal((await call(`/api/agent/jobs/${job.id}/lease`, 'POST', lease(c), undefined, p.token)).status, 409);
});

test('expired execution is blocked rather than silently repeated; explicit retries stop after three attempts', async () => {
  const p = await project(); const job = await queue(p);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const c = await claim(p); assert.equal(c.attempt, attempt);
    await runtime.database.query("UPDATE qa_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [job.id]);
    assert.equal((await claim(p)).job, null);
    assert.equal((await call(`/api/agent/jobs/${job.id}/lease`, 'POST', lease(c), undefined, p.token)).status, 409);
    const retry = await call(`/api/projects/${p.id}/jobs/${job.id}/retry`, 'POST', {}, alice);
    assert.equal(retry.status, attempt < 3 ? 200 : 409);
  }
});

test('jobs and dedupe persist across database restart and profile changes do not alter queued input', async () => {
  const p = await project(), body = input(); const job = await queue(p, body);
  await call(`/api/projects/${p.id}`, 'PATCH', { testingProfile: { ...profile, previewUrlTemplate: 'https://new.example.test' } }, alice);
  await runtime.database.end(); const database = await createPGliteDatabase(directory); runtime = { database, config, auth: createAuth(database, config) };
  const repeated = await call(`/api/projects/${p.id}/jobs`, 'POST', body, alice); const value = await repeated.json();
  assert.equal(value.duplicate, true); assert.equal(value.job.id, job.id); assert.equal(value.job.testingProfile.previewUrlTemplate, profile.previewUrlTemplate);
  assert.equal((await call(`/api/projects/${p.id}/jobs`, 'POST', { ...body, prNumber: 43 }, alice)).status, 409);
});

test('token rotation revokes old agent claims and invalidates in-flight execution leases', async () => {
  const p = await project(); const job = await queue(p); const c = await claim(p);
  const issued = await call(`/api/projects/${p.id}/token`, 'POST', {}, alice); const replacement = (await issued.json()).token;
  assert.equal((await call('/api/agent/jobs/claim', 'POST', { runnerId: runner.id }, undefined, p.token)).status, 401);
  assert.equal((await call(`/api/agent/jobs/${job.id}/lease`, 'POST', lease(c), undefined, replacement)).status, 409);
  const list = await call(`/api/projects/${p.id}/jobs`, 'GET', undefined, alice); assert.equal((await list.json()).jobs[0].status, 'blocked');
  assert.equal((await call('/api/agent/jobs/claim', 'POST', { runnerId: runner.id }, undefined, replacement)).status, 409);
});

test('queue capacity is enforced and schema cannot contain hosted secrets or arbitrary commands', async () => {
  const p = await project();
  for (let i = 0; i < 20; i++) await queue(p);
  assert.equal((await call(`/api/projects/${p.id}/jobs`, 'POST', input(), alice)).status, 409);
  assert.equal((await call(`/api/projects/${p.id}`, 'PATCH', { testingProfile: { ...profile, command: 'touch product' } }, alice)).status, 400);
  assert.equal((await call('/api/agent/heartbeat', 'POST', { models: [], runner: { ...runner, command: 'sh' } }, undefined, p.token)).status, 400);
  assert.equal((await call(`/api/projects/${p.id}`, 'DELETE', undefined, alice)).status, 200);
  const count = await runtime.database.query<{ count: string }>('SELECT count(*) AS count FROM qa_jobs WHERE project_id=$1', [p.id]); assert.equal(Number(count.rows[0].count), 0);
});
