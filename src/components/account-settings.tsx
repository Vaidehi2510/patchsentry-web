"use client";
import {EnterpriseAccess,CompanySignIn} from "./enterprise-access";
import { useEffect, useState } from "react";
import Link from "next/link";
import { UserRound, ShieldCheck, Globe, KeyRound } from "lucide-react";
import type { Project } from "@/lib/contracts";
async function call(path: string, method = "GET", body?: unknown) {
  const r = await fetch(path, {
    method,
    cache: "no-store",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const d = await r.json();
  if (!r.ok)
    throw Object.assign(
      new Error(d.error || "Could not update your account."),
      { status: r.status },
    );
  return d;
}
type Account = {
  user: { name: string; email: string };
  method: string;
  strictMfa: boolean;
  freshMfa: boolean;
  sessions: Array<{
    id: string;
    current: boolean;
    browser: string;
    createdAt: string;
  }>;
  devices: Array<{ id: string; label: string; expires_at: string }>;
};
export function AccountSettings({
  demo,
  projects,
  onProfile,
}: {
  demo: boolean;
  projects: Project[];
  onProfile: (name: string) => void;
}) {
  const [account, setAccount] = useState<Account | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    if (demo) {
      setAccount({
        user: { name: "Alex Morgan", email: "alex@example.test" },
        method: "totp",
        strictMfa: true,
        freshMfa: true,
        sessions: [],
        devices: [],
      });
      setName("Alex Morgan");
      return;
    }
    const d = await call("/api/account").catch((e) => {
      if (e.status === 401) {
        location.assign("/auth/setup?next=account");
        return null;
      }
      throw e;
    });
    if (!d) return;
    setAccount(d);
    setName(d.user.name);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [demo]);
  async function action(fn: () => Promise<void>) {
    if (demo) {
      setMessage("Demo preview. Sign in to manage your own account.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-settings">
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
      <section className="panel operations-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">YOUR ACCOUNT</span>
            <h2>
              <UserRound size={23} /> Personal profile
            </h2>
            <p>
              One account can belong to several product teams. Permissions are
              assigned separately for each project.
            </p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await call("/api/account/profile", "PATCH", { name });
              onProfile(name);
              setMessage("Your name has been updated.");
            });
          }}
        >
          <label>
            Display name
            <input
              value={name}
              maxLength={100}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p>
            Verified sign-in email:{" "}
            <strong>{account?.user.email || "Loading…"}</strong>
          </p>
          <button className="button button-primary" disabled={busy || !account}>
            Save profile
          </button>
        </form>
      </section>
      <section className="panel operations-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SIGN-IN SECURITY</span>
            <h2>
              <ShieldCheck size={23} /> Password &amp; verification
            </h2>
            <p>
              {account?.strictMfa
                ? "You own or administer at least one project. MFA is required at every password login, even on a remembered browser."
                : "QA engineers and viewers can remember a browser for 30 days after MFA. New browsers, expired trust and account recovery require MFA."}
            </p>
          </div>
        </div>
        <p>
          Your second factor:{" "}
          <strong>
            {account?.method === "totp" ? "Authenticator app" : "Email code"}
          </strong>
          . Password and email changes require MFA within the last 15 minutes.
        </p>
        <button
          className="button button-secondary"
          disabled={busy || demo || !account}
          onClick={() =>
            action(async () => {
              const r = await call("/api/security/step-up", "POST", {});
              location.assign(r.next);
            })
          }
        >
          Verify MFA for account changes
        </button>
        <details>
          <summary>Change your password</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                data = new FormData(form);
              action(async () => {
                await call(
                  "/api/account/password",
                  "POST",
                  Object.fromEntries(data),
                );
                form.reset();
                setMessage(
                  "Password changed. Other sessions and remembered browsers have been revoked.",
                );
              });
            }}
          >
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              New password
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <label>
              Confirm new password
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <button
              className="button button-primary"
              disabled={busy || !account}
            >
              Change password
            </button>
          </form>
        </details>
        <details>
          <summary>Change your email address</summary>
          <p>
            Confirm your current inbox first, then your new inbox. You will keep
            your projects and memberships, then sign in again. A work email does
            not grant company access automatically.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                data = new FormData(form);
              action(async () => {
                const r = await call(
                  "/api/account/email",
                  "POST",
                  Object.fromEntries(data),
                );
                form.reset();
                setMessage(r.message);
              });
            }}
          >
            <label>
              New email address
              <input
                name="newEmail"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
            <label>
              Password to confirm email change
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <button
              className="button button-primary"
              disabled={busy || !account}
            >
              Send email-change confirmation
            </button>
          </form>
        </details>
        <p className="fineprint">
          Need to change your second factor? Keep your authenticator recovery
          codes secure. Factor replacement is not offered through a bypass;
          account recovery must preserve verification.
        </p>
      </section>
      <section className="panel operations-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DEVICES & SESSIONS</span>
            <h2>
              <KeyRound size={23} /> Where you are signed in
            </h2>
            <p>
              Revoking remembered browsers makes MFA necessary at the next
              sign-in. “Sign out other sessions” also ends their current access.
            </p>
          </div>
        </div>
        <div className="operations-list">
          {account?.sessions.map((s) => (
            <div key={s.id}>
              <span>
                <strong>{s.current ? "This session" : "Other session"}</strong>
                <small className="account-browser">{s.browser}</small>
                <small>Started {new Date(s.createdAt).toLocaleString()}</small>
              </span>
              {!s.current && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await call("/api/account/sessions/revoke", "POST", {
                        id: s.id,
                      });
                      setMessage("Session signed out.");
                    })
                  }
                >
                  Sign out session
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          className="button button-secondary"
          disabled={busy || !account}
          onClick={() =>
            action(async () => {
              await call("/api/account/sessions/revoke", "POST", {
                allOthers: true,
              });
              setMessage(
                "Other sessions signed out and remembered browsers revoked.",
              );
            })
          }
        >
          Sign out other sessions
        </button>
        <h3>Remembered browsers</h3>
        <div className="operations-list">
          {account?.devices.map((d) => (
            <div key={d.id}>
              <span>
                <strong className="account-browser">{d.label}</strong>
                <small>
                  Trust expires {new Date(d.expires_at).toLocaleDateString()}
                </small>
              </span>
            </div>
          ))}
        </div>
        {!account?.devices.length && (
          <p className="fineprint">No remembered browsers.</p>
        )}
        <button
          className="text-button"
          disabled={busy || !account}
          onClick={() =>
            action(async () => {
              await call("/api/account/devices/revoke", "POST", {});
              setMessage("Remembered browser trust revoked.");
            })
          }
        >
          Forget all remembered browsers
        </button>
      </section>
      <section className="panel operations-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">WORK & PERSONAL PROJECTS</span>
            <h2>
              <Globe size={23} /> Your workspaces
            </h2>
            <p>
              Invite-only membership keeps company information private. A
              verified work domain can restrict a project to invited members with matching verified email addresses. It does not give everyone at that domain access.
            </p>
          </div>
        </div>
        <div className="operations-list">
          {projects.map((p) => (
            <div key={p.id}>
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.repository} · Patchsentry {p.accessRole || "owner"}
                </small>
              </span>
              <Link
                className="text-button"
                href={`/app?project=${p.id}&tab=overview`}
              >
                Open workspace
              </Link>
            </div>
          ))}
        </div>
        {projects
          .filter((p) => ["owner", "admin"].includes(p.accessRole || "owner"))
          .map((p) => (
            <WorkDomain key={p.id} project={p} demo={demo} />
          ))}
        <CompanySignIn link/>
        {projects.map(p=><EnterpriseAccess key={p.id} project={p} demo={demo}/>)}
        <p>
          <Link href="/architecture">
            How roles, repositories and the QA runner fit together →
          </Link>
        </p>
      </section>
    </div>
  );
}
function WorkDomain({ project, demo }: { project: Project; demo: boolean }) {
  const [incompatible, setIncompatible] = useState<Array<{id:string;email:string}>>([]);
  const isOwner=(project.accessRole || "owner")==="owner";
  const [domain, setDomain] = useState<any>(null),
    [value, setValue] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const root = `/api/projects/${project.id}/domain`;
  useEffect(() => {
    if (!demo)
      call(root)
        .then((d) => {
          setDomain(d.domain);
          setIncompatible(d.incompatibleMembers || []);
          setValue(d.domain?.name || "");
        })
        .catch((e) => setError(e.message));
  }, [root, demo]);
  async function action(kind: string) {
    if (demo) {
      setMessage("Domain setup requires your real workspace and DNS access.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const d = await call(
        kind === "verify" ? root + "/verify" : root,
        kind === "remove" ? "DELETE" : kind === "restrict" || kind === "unrestrict" ? "PATCH" : "POST",
        kind === "save" ? { domain: value } : kind === "restrict" || kind === "unrestrict" ? {restricted:kind==="restrict"} : {},
      );
      setDomain(d.domain || null);
      setIncompatible(d.incompatibleMembers || []);
      setMessage(
        kind === "restrict" ? "Domain restrictions enabled. Results stay in the authenticated dashboard." : kind === "unrestrict" ? "Domain restrictions disabled. Project membership still requires an invitation." : kind === "verify"
          ? "Domain verified. Membership still requires an invitation."
          : kind === "remove"
            ? "Domain association removed."
            : "Add the TXT record below, then check verification.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="work-domain">
      <summary>Company access & domain for {project.name}</summary>
      <p>
        Use a domain whose DNS you administer. Your private workspace is{" "}
        <Link href={`/app?project=${project.id}`}>{project.name}</Link>.
        Verifying a domain grants no GitHub permissions and does not enable
        automatic joining. Your DNS administrator must add the TXT record. Only the project owner can change this policy, after recent MFA verification.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action("save");
        }}
      >
        <label>
          Company domain
          <input
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="example.com"
            disabled={!isOwner || domain?.restricted}
            maxLength={253}
          />
        </label>
        <button className="button button-secondary" disabled={busy || !isOwner || domain?.restricted}>
          Create DNS verification record
        </button>
      </form>
      {domain && (
        <div className="notice">
          <div>
            <strong>
              {domain.verifiedAt
                ? "Verified domain"
                : "DNS verification pending"}
              : {domain.name}
            </strong>
            <p>
              Type: TXT
              <br />
              Name: <code>{domain.recordName}</code>
              <br />
              Value:{" "}
              <code className="connection-fingerprint">
                {domain.recordValue}
              </code>
            </p>
            <p>
              New challenges expire after 24 hours. Keep the record while using
              this association.
            </p>
            <button
              className="button button-secondary"
              disabled={busy || !isOwner}
              onClick={() => action("verify")}
            >
              Check DNS verification
            </button>
            <h3>{domain.restricted ? "Domain restriction active" : "Restrict project access"}</h3>
            <p>When enabled, every member must have a verified email at <strong>@{domain.name}</strong>. Subdomains are separate domains. Membership and roles apply to this project only. Outside accounts cannot open its reports, evidence, exports or weekly summaries, even with an old session.</p>
            <p>QA reports stay in the dashboard. Email and Slack report delivery is blocked, including queued messages. Invitations may still be emailed to matching addresses. Previously downloaded or delivered copies cannot be recalled.</p>
            <details><summary>SSO and trusted integrations</summary><p>Configure Microsoft Entra company sign-in in the separate panel below. DNS verification alone does not enable SSO. Google Workspace and Okta integrations are not included in this Entra connection. Existing project service credentials and approved AI providers remain authorized; review them before adding sensitive product data.</p></details>
            {!domain.restricted && incompatible.length>0 && <div role="status"><strong>Update these members before enabling:</strong><ul>{incompatible.map(m=><li key={m.id}>{m.email}</li>)}</ul><Link href={`/app?project=${project.id}&tab=team`}>Manage project members →</Link><p>The owner must also use a matching verified address. You can change your email in My account.</p></div>}
            <button className="button button-primary" disabled={busy || !isOwner || !domain.verifiedAt || !domain.restricted && incompatible.length>0} onClick={()=>{if(window.confirm(domain.restricted ? "Allow invited external accounts again? Reports still require project membership." : "Restrict this project to @"+domain.name+"? Outside invitations will be revoked and outbound QA reports disabled."))action(domain.restricted?"unrestrict":"restrict");}}>{domain.restricted ? "Turn off domain restriction" : "Require @"+domain.name+" membership"}</button>
            <button
              className="text-button"
              disabled={busy || !isOwner || domain.restricted}
              onClick={() => {
                if (confirm("Remove this workspace’s domain association?"))
                  action("remove");
              }}
            >
              Remove domain
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="fineprint">
          {message}
        </p>
      )}
    </details>
  );
}
