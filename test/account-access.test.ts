import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createPGliteDatabase } from "../src/lib/server/database";
import { createAuth, migrateDatabase } from "../src/lib/server/auth";
import { handleRequest } from "../src/lib/server/api";
import { cookieJar, totp } from "./auth-session";
import { invitationEmail } from "../src/lib/server/email";
import type { Runtime } from "../src/lib/server/runtime";
import { randomUUID, createHash } from 'node:crypto';
import { claimNotification, queueNotification } from '../src/lib/server/team';
import { generateWeeklyReport, deliverWeekly } from '../src/lib/server/weekly';
const mailCodes = new Map<string, string>();
const links = new Map<string, string>(),
  invitations: any[] = [],
  accounts: Record<string, { cookie: string; codes: string[]; id: string }> =
    {};
let failedMail = false;
const config = {
  origin: "https://portal.example",
  secret: "account-access-fixture-only-secret-at-least-32-characters",
  production: false,
  sendSignInLink: async ({ email, url }: { email: string; url: string }) => {
    links.set(email, url);
  },
  sendSecurityCode: async ({
    email,
    code,
  }: {
    email: string;
    code: string;
  }) => {
    mailCodes.set(email, code);
  },
  sendInvitation: async (message: any) => {
    if (failedMail) throw new Error("fixture SMTP unconfirmed");
    invitations.push(message);
  },
};
let runtime: Runtime,
  projectId: string,
  loginIp = 170;
const password = "Fixture account password 2026!";
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  who = "owner",
  options: { agent?: string; ua?: string; cookie?: string; ip?: string } = {},
) {
  const account = accounts[who];
  const r = await handleRequest(
    new Request(config.origin + path, {
      method,
      headers: {
        origin: config.origin,
        "content-type": "application/json",
        "user-agent": options.ua || "Fixture browser",
        "x-forwarded-for":
          options.ip || `192.0.2.${Object.keys(accounts).indexOf(who) + 130}`,
        ...(options.agent
          ? { authorization: `Bearer ${options.agent}` }
          : { cookie: options.cookie ?? account?.cookie ?? "" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    runtime,
  );
  if (account && options.cookie === undefined)
    account.cookie = cookieJar(account.cookie, r);
  return r;
}
async function logout(who: string) {
  assert.equal((await api("/api/auth/sign-out", "POST", {}, who)).status, 200);
}
async function login(who: string, ua?: string) {
  const r = await api(
    "/api/auth/sign-in/email",
    "POST",
    { email: who + "@example.test", password },
    who,
    { ua, ip: `192.0.2.${loginIp++}` },
  );
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}
async function verify(who: string, rememberDevice = true) {
  const r = await api(
    "/api/security/verify",
    "POST",
    { code: accounts[who].codes.shift(), recovery: true, rememberDevice },
    who,
    { ip: `192.0.2.${loginIp++}` },
  );
  assert.equal(r.status, 200, await r.clone().text());
  return r;
}
before(async () => {
  const database = await createPGliteDatabase();
  await migrateDatabase(database, config);
  runtime = { database, config, auth: createAuth(database, config) };
  for (const who of [
    "owner",
    "admin",
    "qa",
    "viewer",
    "outsider",
    "emailuser",
    "mailviewer",
  ]) {
    accounts[who] = { cookie: "", codes: [], id: "" };
    await api(
      "/api/auth/sign-in/magic-link",
      "POST",
      { email: who + "@example.test", name: who },
      who,
    );
    const url = new URL(links.get(who + "@example.test")!);
    await api(url.pathname + url.search, "GET", undefined, who);
    assert.equal(
      (
        await api(
          "/api/security/password",
          "POST",
          { password, confirmPassword: password },
          who,
        )
      ).status,
      200,
    );
    const enrollment = await (
      await api(
        "/api/security/enroll",
        "POST",
        { method: who === "mailviewer" ? "email" : "totp", password },
        who,
      )
    ).json();
    accounts[who].codes = enrollment.backupCodes || [];
    const verified = await api(
      "/api/security/verify",
      "POST",
      {
        code:
          who === "mailviewer"
            ? mailCodes.get(who + "@example.test")
            : totp(enrollment.totpURI),
      },
      who,
    );
    assert.equal(verified.status, 200, await verified.text());
    accounts[who].id = (
      await (await api("/api/session", "GET", undefined, who)).json()
    ).user.id;
  }
  const p = await (
    await api("/api/projects", "POST", {
      name: "Private company project",
      repository: "fixture/company-product",
    })
  ).json();
  projectId = p.project.id;
  for (const who of ["admin", "qa", "viewer", "mailviewer"]) {
    const invitation = await (
      await api(`/api/projects/${projectId}/team`, "POST", {
        email: who + "@example.test",
        role: who === "mailviewer" ? "viewer" : who,
      })
    ).json();
    assert.equal(invitation.delivery, "accepted");
    assert.equal(
      (
        await api(
          "/api/invitations/accept",
          "POST",
          { token: invitation.token },
          who,
        )
      ).status,
      200,
    );
  }
});
after(() => runtime.database.end());

test("same remembered browser skips MFA only after valid password; absent cookies or changed browser requires MFA", async () => {
  await logout("viewer");
  assert.equal((await login("viewer")).twoFactorRequired, true);
  await verify("viewer");
  assert.match(accounts.viewer.cookie, /ps-device=/);
  const row = (
    await runtime.database.query<any>(
      "SELECT id FROM qa_trusted_devices WHERE user_id=$1",
      [accounts.viewer.id],
    )
  ).rows[0];
  assert.ok(row);
  await logout("viewer");
  const remembered = await login("viewer");
  assert.equal(remembered.twoFactorRequired, false);
  assert.equal(remembered.next, "/app");
  assert.ok(
    (await (await api("/api/session", "GET", undefined, "viewer")).json()).user,
  );
  const account = await (
    await api("/api/account", "GET", undefined, "viewer")
  ).json();
  assert.equal(account.freshMfa, false);
  assert.equal(account.strictMfa, false);
  assert.equal((await api("/api/projects","POST",{name:"Personal product",repository:"fixture/own-product"},"viewer")).status,403);
  assert.equal(
    (
      await api(
        "/api/account/email",
        "POST",
        { newEmail: "other@example.test", password },
        "viewer",
      )
    ).status,
    403,
  );
  await logout("viewer");
  assert.equal(
    (await login("viewer", "Different browser")).twoFactorRequired,
    true,
  );
  await verify("viewer", false);
});

test("QA engineers can remember browsers; promotion to admin blocks existing remembered sessions immediately", async () => {
  await logout("qa");
  await login("qa");
  await verify("qa");
  await logout("qa");
  assert.equal((await login("qa")).twoFactorRequired, false);
  assert.equal(
    (
      await api(`/api/projects/${projectId}/team/${accounts.qa.id}`, "PATCH", {
        role: "admin",
      })
    ).status,
    200,
  );
  assert.equal(
    (await api("/api/projects", "GET", undefined, "qa")).status,
    401,
  );
  assert.equal(
    (await (await api("/api/security/status", "GET", undefined, "qa")).json())
      .step,
    "verify",
  );
  await verify("qa");
  await logout("qa");
  assert.equal((await login("qa")).twoFactorRequired, true);
  await verify("qa");
  assert.equal(
    (
      await api(`/api/projects/${projectId}/team/${accounts.qa.id}`, "PATCH", {
        role: "qa",
      })
    ).status,
    200,
  );
});

test("owners and admins always complete MFA, even with the remember option, forged native trust or another account’s device cookie", async () => {
  for (const who of ["owner", "admin"]) {
    await logout(who);
    assert.equal((await login(who)).twoFactorRequired, true);
    await verify(who);
    assert.equal(
      (
        await runtime.database.query(
          "SELECT id FROM qa_trusted_devices WHERE user_id=$1",
          [accounts[who].id],
        )
      ).rows.length,
      0,
    );
    await logout(who);
    const extra = accounts.viewer.cookie
      .split("; ")
      .filter((p) => p.includes("trust_device=") || p.startsWith("ps-device="));
    accounts[who].cookie += "; " + extra.join("; ");
    assert.equal((await login(who)).twoFactorRequired, true);
    await verify(who);
  }
});

test("revocation invalidates device-based sessions and native trust; another user cannot revoke your session", async () => {
  await api("/api/account/devices/revoke", "POST", {}, "viewer");
  await logout("viewer");
  await login("viewer");
  await verify("viewer");
  await logout("viewer");
  assert.equal((await login("viewer")).twoFactorRequired, false);
  const account = await (
    await api("/api/account", "GET", undefined, "viewer")
  ).json();
  assert.equal(
    (
      await api(
        "/api/account/sessions/revoke",
        "POST",
        { id: account.sessions[0].id },
        "outsider",
      )
    ).status,
    404,
  );
  assert.equal(
    (await api("/api/account/devices/revoke", "POST", {}, "viewer")).status,
    200,
  );
  assert.equal(
    (await api("/api/projects", "GET", undefined, "viewer")).status,
    401,
  );
  await logout("viewer");
  assert.equal((await login("viewer")).twoFactorRequired, true);
  await verify("viewer", false);
});

test("profile updates preserve memberships; password changes require current password and revoke other sessions and browser trust", async () => {
  assert.equal(
    (await api("/api/account/profile", "PATCH", { name: "QA Account Owner" }))
      .status,
    200,
  );
  assert.equal(
    (await (await api("/api/session")).json()).user.name,
    "QA Account Owner",
  );
  assert.equal(
    (
      await api("/api/account/password", "POST", {
        currentPassword: "wrong password",
        newPassword: "New fixture password 2026!",
        confirmPassword: "New fixture password 2026!",
      })
    ).status,
    400,
  );
  const changed = await api("/api/account/password", "POST", {
    currentPassword: password,
    newPassword: "New fixture password 2026!",
    confirmPassword: "New fixture password 2026!",
  });
  assert.equal(changed.status, 200, await changed.text());
  assert.ok((await (await api("/api/session")).json()).user);
  assert.equal(
    (await (await api("/api/projects")).json()).projects[0].id,
    projectId,
  );
});

test("email change requires confirmation at both old and new inboxes and invalidates sessions after completion", async () => {
  const r = await api(
    "/api/account/email",
    "POST",
    { newEmail: "new-work@example.test", password },
    "emailuser",
  );
  assert.equal(r.status, 200, await r.text());
  let stored = (
    await runtime.database.query<any>('SELECT email FROM "user" WHERE id=$1', [
      accounts.emailuser.id,
    ])
  ).rows[0];
  assert.equal(stored.email, "emailuser@example.test");
  const old = new URL(links.get("emailuser@example.test")!);
  assert.equal(old.pathname, "/api/auth/verify-email");
  await api(old.pathname + old.search, "GET", undefined, "emailuser");
  assert.ok(links.has("new-work@example.test"));
  stored = (
    await runtime.database.query<any>('SELECT email FROM "user" WHERE id=$1', [
      accounts.emailuser.id,
    ])
  ).rows[0];
  assert.equal(stored.email, "emailuser@example.test");
  const next = new URL(links.get("new-work@example.test")!);
  const final = await api(
    next.pathname + next.search,
    "GET",
    undefined,
    "emailuser",
  );
  assert.ok([200, 302].includes(final.status));
  stored = (
    await runtime.database.query<any>(
      'SELECT email,"emailVerified" FROM "user" WHERE id=$1',
      [accounts.emailuser.id],
    )
  ).rows[0];
  assert.equal(stored.email, "new-work@example.test");
  assert.equal(stored.emailVerified, true);
  assert.equal(
    (await (await api("/api/session", "GET", undefined, "emailuser")).json())
      .user,
    null,
  );
  assert.equal(
    (
      await runtime.database.query(
        "SELECT id FROM qa_trusted_devices WHERE user_id=$1",
        [accounts.emailuser.id],
      )
    ).rows.length,
    0,
  );
});

test("invitations send a real email message through the configured adapter, remain email-bound and report delivery failures honestly", async () => {
  const root = `/api/projects/${projectId}`;
  const invited = await api(root + "/team", "POST", {
    email: "newteammate@example.test",
    role: "qa",
  });
  assert.equal(invited.status, 201);
  const data = await invited.json();
  assert.equal(data.delivery, "accepted");
  const message = invitations.at(-1);
  assert.equal(message.email, "newteammate@example.test");
  assert.equal(message.url, config.origin + "/invite#token=" + data.token);
  const rendered = invitationEmail(message, config.origin);
  assert.match(rendered.text, /Sign in or create an account/);
  assert.ok(!message.url.includes("?"));
  const row = (
    await runtime.database.query<any>(
      "SELECT * FROM qa_invites WHERE project_id=$1 AND email=$2",
      [projectId, message.email],
    )
  ).rows[0];
  assert.ok(!JSON.stringify(row).includes(data.token));
  assert.equal(
    (
      await api(
        "/api/invitations/preview",
        "POST",
        { token: data.token },
        "outsider",
      )
    ).status,
    404,
  );
  failedMail = true;
  try {
    const failed = await (
      await api(root + "/team", "POST", {
        email: "retryteammate@example.test",
        role: "viewer",
      })
    ).json();
    assert.equal(failed.delivery, "unconfirmed");
    assert.ok(failed.token);
    const pending = await (await api(root + "/team")).json();
    assert.equal(
      pending.pending.find((i: any) => i.email === "retryteammate@example.test")
        .delivery_status,
      "unconfirmed",
    );
  } finally {
    failedMail = false;
  }
  assert.equal(
    (
      await api(
        root + "/team",
        "POST",
        { email: "admin@example.test", role: "viewer" },
        "admin",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await api(root + "/team", "POST", {
        email: "owner@example.test",
        role: "qa",
      })
    ).status,
    409,
  );
});

test("company domains require exact project-bound DNS proof and admin permissions; they never grant access automatically", async () => {
  const root = `/api/projects/${projectId}/domain`;
  assert.equal(
    (await api(root, "POST", { domain: "https://company.example" })).status,
    400,
  );
  assert.equal(
    (await api(root, "POST", { domain: "company.example" }, "viewer")).status,
    403,
  );
  const configured = await (
    await api(root, "POST", { domain: "company.example" })
  ).json();
  assert.equal(configured.domain.verifiedAt, null);
  runtime.domainResolve = async () => [["wrong TXT value"]];
  assert.equal((await api(root + "/verify", "POST", {})).status, 409);
  runtime.domainResolve = async (name) => {
    assert.equal(name, "_patchsentry.company.example");
    return [
      [
        configured.domain.recordValue.slice(0, 20),
        configured.domain.recordValue.slice(20),
      ],
    ];
  };
  const verified = await (await api(root + "/verify", "POST", {})).json();
  assert.ok(verified.domain.verifiedAt);
  assert.equal(
    (await api(`/api/projects/${projectId}`, "GET", undefined, "outsider"))
      .status,
    404,
  );
  assert.equal((await api(root, "DELETE", {})).status, 200);
});

test("email second factors also remember a browser and expiry forces a fresh challenge", async () => {
  await logout("mailviewer");
  assert.equal((await login("mailviewer")).twoFactorRequired, true);
  const sent = await api("/api/security/send-code", "POST", {}, "mailviewer");
  assert.equal(sent.status, 200);
  const verified = await api(
    "/api/security/verify",
    "POST",
    { code: mailCodes.get("mailviewer@example.test"), rememberDevice: true },
    "mailviewer",
  );
  assert.equal(verified.status, 200, await verified.text());
  await logout("mailviewer");
  assert.equal((await login("mailviewer")).twoFactorRequired, false);
  await runtime.database.query(
    "UPDATE qa_trusted_devices SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [accounts.mailviewer.id],
  );
  assert.equal(
    (await api("/api/account", "GET", undefined, "mailviewer")).status,
    401,
  );
  await logout("mailviewer");
  assert.equal((await login("mailviewer")).twoFactorRequired, true);
});

test("role editing never grants owner access or lets admins change other admins", async () => {
  const root = `/api/projects/${projectId}/team/`;
  assert.equal(
    (await api(root + accounts.viewer.id, "PATCH", { role: "admin" }, "admin"))
      .status,
    403,
  );
  assert.equal(
    (await api(root + accounts.admin.id, "PATCH", { role: "viewer" }, "admin"))
      .status,
    403,
  );
  assert.equal(
    (await api(root + accounts.owner.id, "PATCH", { role: "viewer" })).status,
    404,
  );
  assert.equal(
    (await api(root + accounts.qa.id, "PATCH", { role: "owner" })).status,
    400,
  );
  assert.equal(
    (await api(root + accounts.viewer.id, "PATCH", { role: "qa" }, "viewer"))
      .status,
    403,
  );
});

test('domain restrictions isolate reports and invitations, including existing sessions and outbound delivery', async () => {
  const created=await api('/api/projects','POST',{name:'Domain restricted fixture',repository:'fixture/domain-product'});
  assert.equal(created.status,201,await created.clone().text());
  const id=(await created.json()).project.id,root=`/api/projects/${id}`,domain=root+'/domain';
  // Current member with another address must be resolved before activation.
  await runtime.database.query('INSERT INTO qa_members(project_id,user_id,role) VALUES($1,$2,$3)',[id,accounts.qa.id,'qa']);
  await runtime.database.query('UPDATE "user" SET email=$2 WHERE id=$1',[accounts.qa.id,'qa@outside.test']);
  const pending=await(await api(root+'/team','POST',{email:'external@outside.test',role:'viewer'})).json();
  const configured=await(await api(domain,'POST',{domain:'example.test'})).json();
  assert.equal((await api(domain,'PATCH',{restricted:true})).status,409);
  runtime.domainResolve=async()=>[[configured.domain.recordValue]];
  const verified=await(await api(domain+'/verify','POST',{})).json();
  assert.equal(verified.incompatibleMembers[0].email,'qa@outside.test');
  assert.equal((await api(domain,'PATCH',{restricted:true})).status,409);
  await runtime.database.query('UPDATE "user" SET email=$2 WHERE id=$1',[accounts.qa.id,'qa@example.test']);
  // A previously issued notification must not be claimed after restriction.
  await api(root+'/slack','PATCH',{enabled:true,channelId:'C0123456789',events:['completed']});
  await queueNotification(runtime.database.query.bind(runtime.database),id,'completed','fixture:queued',{jobId:'fixture',message:'Private result'});
  const enabled=await api(domain,'PATCH',{restricted:true});
  assert.equal(enabled.status,200,await enabled.clone().text());
  assert.equal((await enabled.json()).domain.restricted,true);
  assert.equal((await runtime.database.query('SELECT token_hash FROM qa_invites WHERE token_hash=$1',[createHash('sha256').update(pending.token).digest('hex')])).rows.length,0);
  assert.equal((await api(domain,'DELETE',{})).status,409);
  assert.equal((await api(domain,'POST',{domain:'other.test'})).status,409);
  assert.equal((await api(root+'/team','POST',{email:'external@outside.test',role:'viewer'})).status,403);
  assert.equal((await api(root+'/team','POST',{email:'external@sub.example.test',role:'viewer'})).status,403);
  assert.equal((await api(root+'/team','POST',{email:'external@example.test.attacker.test',role:'viewer'})).status,403);
  // A same-domain user still needs a project-specific invitation.
  assert.equal((await api(root,'GET',undefined,'outsider')).status,404);
  const invite=await(await api(root+'/team','POST',{email:'outsider@example.test',role:'viewer'})).json();
  assert.equal((await api('/api/invitations/accept','POST',{token:invite.token},'outsider')).status,200);
  assert.equal((await api(root,'GET',undefined,'outsider')).status,200);
  assert.equal((await api(root+'/jobs','POST',{},'outsider')).status,403);
  assert.equal((await api(domain,'PATCH',{restricted:false},'qa')).status,403);
  await runtime.database.query('INSERT INTO qa_members(project_id,user_id,role) VALUES($1,$2,$3)',[id,accounts.admin.id,'admin']);
  assert.equal((await api(domain,'PATCH',{restricted:false},'admin')).status,403);
  assert.equal((await api(domain,'GET',undefined,'admin')).status,200);
  // Database identity is checked on every request, even with an existing session.
  await runtime.database.query('UPDATE "user" SET email=$2 WHERE id=$1',[accounts.qa.id,'qa@outside.test']);
  const hiddenPaths=[root,root+'/runs',root+'/weekly-reports',root+'/requirements',root+'/audit-export',root+'/evidence/'+randomUUID(),root+'/team'];
  for(const path of hiddenPaths)assert.equal((await api(path,'GET',undefined,'qa')).status,404,path);
  assert.ok(!(await(await api('/api/projects','GET',undefined,'qa')).json()).projects.some((p:any)=>p.id===id));
  await runtime.database.query('UPDATE "user" SET email=$2 WHERE id=$1',[accounts.qa.id,'qa@example.test']);
  await runtime.database.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1',[accounts.qa.id]);
  assert.notEqual((await api(root,'GET',undefined,'qa')).status,200);
  await runtime.database.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[accounts.qa.id]);
  assert.equal((await api(root,'GET',undefined,'qa')).status,200);
  // Prevent an older outstanding email-change link from stranding the owner.
  await assert.rejects(runtime.database.query('UPDATE "user" SET email=$2 WHERE id=$1',[accounts.owner.id,'owner@outside.test']),/domain restriction/);
  assert.equal((await api(root+'/slack','PATCH',{enabled:true,channelId:'C0123456789',events:['completed']})).status,403);
  assert.equal((await claimNotification(runtime.database,id,{channelId:'C0123456789'})).notification,null);
  await queueNotification(runtime.database.query.bind(runtime.database),id,'completed','fixture:blocked',{jobId:'fixture'});
  assert.equal((await runtime.database.query('SELECT id FROM qa_notifications WHERE project_id=$1',[id])).rows.length,1);
  let emails=0;runtime.config.sendWeeklyReport=async()=>{emails++;};
  await runtime.database.query('INSERT INTO qa_automation_settings(project_id,payload) VALUES($1,$2::jsonb)',[id,JSON.stringify({weeklyEmail:true,weeklySlack:true})]);
  const weekly=await generateWeeklyReport(runtime,id);
  await deliverWeekly(runtime,id,String(weekly.id));
  assert.equal(emails,0);
  assert.equal((await runtime.database.query('SELECT id FROM qa_notifications WHERE project_id=$1',[id])).rows.length,1);
  assert.equal((await api(root+'/weekly-reports','GET',undefined,'outsider')).status,200);
  // Outside invitations that predate the policy cannot be accepted, even if retained.
  const token='z'.repeat(43);
  await runtime.database.query('INSERT INTO qa_invites(token_hash,project_id,email,role,expires_at) VALUES($1,$2,$3,$4,now()+interval \'1 day\')',[createHash('sha256').update(token).digest('hex'),id,'qa@outside.test','viewer']);
  await runtime.database.query('UPDATE "user" SET email=$2 WHERE id=$1',[accounts.qa.id,'qa@outside.test']);
  assert.equal((await api('/api/invitations/preview','POST',{token},'qa')).status,403);
  assert.equal((await api('/api/invitations/accept','POST',{token},'qa')).status,403);
  await runtime.database.query('UPDATE "user" SET email=$2 WHERE id=$1',[accounts.qa.id,'qa@example.test']);
  assert.equal((await api(domain,'PATCH',{restricted:false})).status,200);
  assert.equal((await api(root+'/team','POST',{email:'external@outside.test',role:'viewer'})).status,201);
  assert.equal((await api(domain,'DELETE',{})).status,200);
});
