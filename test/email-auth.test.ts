import {secureSession,loginSession} from './auth-session';
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createPGliteDatabase } from "../src/lib/server/database";
import { createAuth, migrateDatabase, type AuthConfig } from "../src/lib/server/auth";
import { handleRequest } from "../src/lib/server/api";
import { gmailSender, signInEmail } from "../src/lib/server/email";

async function fixture(t: TestContext) {
  const database = await createPGliteDatabase();
  t.after(() => database.end());
  const mail: { email: string; url: string }[] = [];
  const config: AuthConfig = { origin: "https://patchsentry.example", secret: "email-fixture-only-secret-at-least-32-characters", production: false, sendSignInLink: async message => { mail.push(message); } };
  await migrateDatabase(database, config);
  const runtime = { database, config, auth: createAuth(database, config) };
  const call = (path: string, body?: unknown, cookie?: string) => handleRequest(new Request(config.origin + path, { method: body === undefined ? "GET" : "POST", headers: { origin: config.origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), runtime);
  const send = (email = "reader@example.test") => call("/api/auth/sign-in/magic-link", { email, name: "Independent Builder" });
  const verify = (url = mail.at(-1)!.url) => { const link = new URL(url); return call(link.pathname + link.search); };
  const users = () => database.query<{ email: string; emailVerified: boolean }>('SELECT email, "emailVerified" FROM "user"');
  return { database, runtime, mail, call, send, verify, users };
}
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");

test("requesting a link creates no account or session; clicking creates one verified owner and replay cannot sign in", async t => {
  const f = await fixture(t);
  const response = await f.send();
  assert.equal(response.status, 200); assert.equal(cookies(response), "");
  assert.equal((await f.users()).rows.length, 0);
  assert.equal((await f.call("/api/projects")).status, 401);
  assert.equal(f.mail.length, 1);
  const token = new URL(f.mail[0].url).searchParams.get("token")!;
  const stored = await f.database.query<{ identifier: string }>('SELECT identifier FROM verification');
  assert.ok(stored.rows.length); assert.ok(!JSON.stringify(stored.rows).includes(token));
  assert.ok(!JSON.stringify(await response.json()).includes(token));
  const verified = await f.verify();
  assert.equal(verified.status, 302); assert.equal(verified.headers.get("location"), f.runtime.config.origin + "/auth/setup");
  assert.ok(cookies(verified).includes("session_token"));
  const users = (await f.users()).rows; assert.equal(users.length, 1); assert.equal(users[0].emailVerified, true);
  assert.equal((await f.call("/api/projects", undefined, cookies(verified))).status, 401);
  const complete=await secureSession(f.runtime,cookies(verified));assert.equal((await f.call("/api/projects",undefined,complete)).status,200);
  const replay = await f.verify(); assert.equal(cookies(replay), ""); assert.match(replay.headers.get("location") || "", /INVALID_TOKEN/);
});

test("expired and malformed links create no accounts and concurrent verification consumes one token once", async t => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 200);
  await f.database.query('UPDATE verification SET "expiresAt" = now() - interval \'1 second\'');
  const expired = await f.verify(); assert.equal(cookies(expired), ""); assert.match(expired.headers.get("location") || "", /INVALID_TOKEN/);
  assert.equal((await f.users()).rows.length, 0);
  const invalid = await f.call("/api/auth/magic-link/verify?token=not-a-real-token&callbackURL=/app&errorCallbackURL=/login"); assert.equal(cookies(invalid), "");
  assert.equal((await f.send()).status, 200);
  const results = await Promise.all([f.verify(), f.verify()]);
  assert.equal(results.filter(result => cookies(result).includes("session_token")).length, 1);
  assert.equal((await f.users()).rows.length, 1);
});

test("legacy unverified sessions cannot access projects; proving email ownership revokes them", async t => {
  const f = await fixture(t); await f.send(); const initial = await f.verify(); const oldCookie = await secureSession(f.runtime,cookies(initial));
  const created = await f.call("/api/projects", { name: "Existing beta project", repository: "builder/legacy-project" }, oldCookie);
  const project = (await created.json()).project;
  const issued = await f.call(`/api/projects/${project.id}/token`, {}, oldCookie);
  const token = (await issued.json()).token;
  // The migration gives existing beta tokens this false marker; no old token
  // may spring back to life when the real mailbox owner later verifies.
  await f.database.query("UPDATE projects SET agent_email_verified=false");
  const agent = () => handleRequest(new Request(f.runtime.config.origin + "/api/agent/config", { headers: { authorization: `Bearer ${token}` } }), f.runtime);
  await f.database.query('UPDATE "user" SET "emailVerified" = false');
  assert.equal((await agent()).status, 401);
  assert.equal((await (await f.call("/api/session", undefined, oldCookie)).json()).user, null);
  assert.equal((await f.call("/api/projects", undefined, oldCookie)).status, 401);
  await f.send(); const proved = await f.verify();
  assert.ok(cookies(proved));
  assert.equal((await f.call("/api/projects", undefined, oldCookie)).status, 401);
  assert.equal((await f.call("/api/projects", undefined, cookies(proved))).status, 401);
  assert.equal((await f.call("/api/security/password",{password:"Fixture passphrase 2026!",confirmPassword:"Fixture passphrase 2026!"},cookies(proved))).status,200);
  const signedIn=await loginSession(f.runtime,"reader@example.test",cookies(proved));
  const projects = (await (await f.call("/api/projects", undefined, signedIn)).json()).projects;
  assert.equal(projects[0].id, project.id); assert.equal(projects[0].tokenConfigured, false);
  assert.equal((await agent()).status, 401);
  assert.equal((await f.call(`/api/projects/${project.id}/token`, {}, signedIn)).status, 200);
  assert.equal((await agent()).status, 401, "Rotation must keep the old token revoked");
  assert.equal((await f.users()).rows[0].emailVerified, true);
});

test("password registration, arbitrary callbacks, malformed email and unavailable delivery cannot create accounts", async t => {
  const f = await fixture(t);
  assert.equal((await f.call("/api/auth/sign-up/email", { name: "Fake", email: "fake@example.test", password: "long-but-unverified-password" })).status, 404);
  assert.equal((await f.call("/api/auth/sign-in/email", { email: "fake@example.test", password: "anything" })).status, 401);
  assert.equal((await f.call("/api/auth/sign-in/magic-link", { email: "not-an-email" })).status, 400);
  assert.equal((await f.call("/api/auth/sign-in/magic-link", { email: "reader@example.test", callbackURL: "https://evil.example" })).status, 400);
  f.runtime.config.sendSignInLink = undefined;
  assert.equal((await f.send()).status, 503); assert.equal(f.mail.length, 0);
  assert.equal((await f.users()).rows.length, 0);
});

test("mail delivery failure never returns a success or a session and never exposes provider errors", async t => {
  const f = await fixture(t);
  f.runtime.config.sendSignInLink = async () => { throw new Error("smtp-private-provider-response"); };
  const result = await f.send(); assert.ok(result.status >= 500); assert.equal(cookies(result), "");
  assert.ok(!(await result.text()).includes("smtp-private-provider-response")); assert.equal((await f.users()).rows.length, 0);
});

test("Gmail setup requires app credentials and email content is bounded to the trusted verification origin", () => {
  assert.equal(gmailSender("https://patchsentry.example", {}), undefined);
  assert.equal(gmailSender("https://patchsentry.example", { SMTP_USER: "bot@gmail.com" }), undefined);
  assert.throws(() => gmailSender("https://patchsentry.example", { SMTP_USER: "bad\r\nBcc: victim", SMTP_PASSWORD: "a".repeat(16) }));
  assert.throws(() => gmailSender("https://patchsentry.example", { SMTP_USER: "bot@gmail.com", SMTP_PASSWORD: "my-regular-password" }));
  assert.equal(typeof gmailSender("https://patchsentry.example", { SMTP_USER: "bot@gmail.com", SMTP_PASSWORD: "aaaa bbbb cccc dddd" }), "function");
  const email = signInEmail({ email: "reader@example.test", url: "https://patchsentry.example/api/auth/magic-link/verify?token=fixture&callbackURL=%2Fapp" }, "https://patchsentry.example");
  assert.match(email.text, /10 minutes/); assert.match(email.html, /&amp;callbackURL=/);
  assert.equal(email.disableUrlAccess, true); assert.equal(email.disableFileAccess, true);
  assert.throws(() => signInEmail({ email: "reader@example.test", url: "https://evil.example/api/auth/magic-link/verify?token=fixture" }, "https://patchsentry.example"));
});
