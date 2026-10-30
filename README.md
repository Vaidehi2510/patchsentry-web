# Patchsentry

A public product website and private QA workspace for [QA-testbot](https://github.com/Vaidehi2510/QA-testbot). Assess pull requests, CI builds and complete release versions; author tests; choose OpenRouter or local models; and see required-check scores, blockers, findings, and suggested fixes in one place.

[Visit Patchsentry](https://patchsentry.vercel.app) · [Explore the demo](https://patchsentry.vercel.app/demo) · [Integration guide](https://patchsentry.vercel.app/docs)

The website is the control and reporting interface. The separate QA engine executes checks in managed isolated cloud workers, or on an optional trusted private runner. It can read product source and publish PR comments, labels, and statuses; it never edits, pushes, or merges product code.

## What is implemented

- Responsive product, workflow, security, and integration documentation pages.
- A clearly labeled interactive demo; demo metrics never appear as real customer results.
- Email-first signup followed by mandatory password and two-factor enrollment; password plus second factor on every new login. Secure cookies, server-side session assurance and database-backed rate limits.
- Account-scoped projects, reports, model settings, and one-time runner enrollment tokens.
- A live OpenRouter catalog with context sizes, tool/vision capabilities, and pricing. Direct encrypted hosted key setup, optional encrypted private-runner delivery, local server discovery and explicit bounded model connection checks are available in Models & agents. See [connection setup](docs/agent.md#guided-model-connections).
- Local model inventories reported by an outbound connector; the website never contacts users’ localhost servers.
- A default model or separate model for each of five QA roles, with per-run budget and call limits.
- Revision- and artifact-specific QA reports, transparent required-check scores, and unverified AI findings.
- Complete-build/release requests with platform, version/build name and artifact SHA-256; fresh-evidence deployment-gate lookup for CI.
- An owner-scoped unit-test library with versioned drafts, exports, bounded enabled Node tests and immutable per-job snapshots.
- A public platform coverage page that distinguishes browser/device execution from attested CI imports.
- A working [outbound runner connector](docs/agent.md) that syncs reports and, with explicit local enrollment, executes immutable website jobs through the reviewed QA engine.
- Guided preview/browser/goal setup, live runner readiness, and durable exact-SHA job queues with leases, cancellation, dedupe and bounded explicit retries.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
cp .env.example .env.local
```

For a local database, remove `DATABASE_URL`, set `PGLITE_DATA_DIR=.local/database`, set `BETTER_AUTH_URL=http://127.0.0.1:3000`, and generate a random `BETTER_AUTH_SECRET`. Keep the origin exact: `localhost` and `127.0.0.1` are different origins.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
npm run dev
```

Visit `http://127.0.0.1:3000`. PGlite persists accounts and projects under the configured directory. It is development-only; production requires PostgreSQL and HTTPS.

## Connect a product on the website

1. Create a project for an authorized GitHub repository.
2. In **Models & agents**, paste and verify your OpenRouter key, select a compatible model, and save your choices. The key field works without a runner.
3. For a private repository, open **Integrations** and verify a fine-grained GitHub token limited to that repository, with Contents: read-only and Metadata: read-only. Public repositories need no token.
4. Save a public HTTPS disposable preview and explicit goal assertions in **Testing setup**. The preview must expose its deployed source SHA in `x-qa-revision`.
5. Request QA for a full source SHA and PR, web build or release. Builds/releases also need a direct artifact download, SHA-256 and deployed artifact identity header. Patchsentry manages the worker and returns reports to the dashboard.

No connector command or always-on customer machine is needed for hosted web QA. See [hosted scope and pilot limits](docs/hosted.md).

## Optional private-network and self-hosted connector

1. Create an account and project using the product’s `owner/repository` name.
2. Set up a separate trusted [QA-testbot](https://github.com/Vaidehi2510/QA-testbot) checkout and configure its GitHub access, PR scope, preview environment, and test runners. Use a separate bot configuration per product.
3. Create a runner token from **Integrations**. Store it in the runner’s `QA_PORTAL_TOKEN` environment variable. It is shown once and can be rotated.
4. Clone this website repository on that runner. Create the explicit local enrollment policy from the [connector guide](docs/agent.md), install the selected browser engines, and run preflight before starting:

```sh
export QA_PORTAL_URL="https://YOUR-SITE.vercel.app"
# Set QA_PORTAL_TOKEN using the runner's secret manager.
node scripts/agent.mjs --bot-dir /path/to/QA-testbot --execute-jobs --runner-policy portal-policy.json --check-runner
node scripts/agent.mjs --bot-dir /path/to/QA-testbot --watch --execute-jobs --runner-policy portal-policy.json
```

5. Keep `OPENROUTER_API_KEY` or `LOCAL_MODEL_API_KEY` on the runner. Select models on the website. The runner applies these choices within its locally enrolled backend, image, and spending policies.
6. Save a profile in **Testing setup**, then request a PR and full commit SHA from Overview. The enrolled runner claims and executes the job. Missing prerequisites remain blocked. Default connector mode can still sync reports from existing workflows without executing jobs.

See [the connector guide](docs/agent.md) for GitHub-hosted state, local capabilities, cross-backend enrollment, report sharing, and exact command options.

## Deploy

Deploy this repository as a Next.js application. Vercel configuration is detected automatically. Attach a persistent PostgreSQL database and set these **server-only** environment variables:

| Variable             | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string with TLS     |
| `BETTER_AUTH_URL`    | Exact public HTTPS origin, without a path |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters   |
| `SMTP_USER` | Dedicated Gmail sender address |
| `SMTP_PASSWORD` | Google app password for that sender; never its ordinary password |

Run `npm run db:migrate` with these variables exported, then deploy. Migrations do not run during ordinary API requests. Production fails closed if persistent account storage is unavailable; the public product site and demo remain available.

The Vercel build wrapper runs the reviewed migrations inside the production build, using Vercel's protected environment variables before publishing the new application. Preview builds skip that step. Sensitive Vercel values do not need to be exported to a developer's machine. Other hosting providers should run `npm run db:migrate` as a deployment preparation step.

### Email setup

Personal, school, and work email addresses can all create accounts. No company domain is required. A user requests a link, receives a branded email, then opens its single-use link within ten minutes. Requesting a link does not create a user or session. Direct password registration is disabled. After verification, users choose a 12–128 character password and verify email-code or authenticator-app enrollment before any project access. Normal login requires email/password and the configured factor; it sends no email-verification link. Password reset uses a single-use emailed link and retains MFA. Existing unverified accounts must prove inbox ownership; their previous sessions are revoked when they verify. Existing beta project tokens must be regenerated in Integrations after verification. Projects and reports are preserved; a token issued before mailbox verification cannot regain access after the account is verified.

For a free beta sender without purchasing a domain, create a dedicated Gmail account, enable 2-Step Verification, and generate an app password at <https://myaccount.google.com/apppasswords>. Add `SMTP_USER` and `SMTP_PASSWORD` directly in the hosting provider's server-only environment settings. Gmail SMTP uses authenticated TLS on port 465. Never commit these values or add a `NEXT_PUBLIC_` prefix. Gmail applies its own delivery limits; use a dedicated transactional provider for a larger rollout. Resend can be added later with a domain you control.

If mail delivery is unconfigured, signup and login show a clear setup notice and link to the interactive demo. Delivery failures cannot create accounts or pretend to have sent a link. Verification tokens are stored hashed, expire in ten minutes, and are consumed atomically. Automated tests capture email in memory; production has no console-mail or verification bypass.

### Readability and motion

The sage and lavender interface supports independent builders and team-owned products. Inputs use at least 16px text, common controls have larger tap targets, and responsive layouts preserve readable text on mobile. Scroll reveals, workflow signals, and preview animations have a persistent pause control and honor `prefers-reduced-motion`. Content remains visible without animation support. Product owners can invite verified teammates as admins, QA engineers or viewers. Optional per-product Slack updates, capability-aware runner fleets and activity history live in Team & operations.

Never deploy with `PGLITE_DATA_DIR`. Vercel serverless disk is not a persistent database. Keep preview deployments separate from production data and configure their own exact auth origin when enabling accounts there.

Deploy from the CLI with `npx vercel deploy --prod`. Automatic deployments from GitHub require connecting the GitHub account in Vercel’s login connections and linking this repository. `.vercelignore` excludes all local environment files, development databases, and test artifacts from CLI uploads. Set `SITE_URL` if using a different public domain.

Free hosting/database tiers have limits. Vercel Hobby is restricted to personal, noncommercial use; review the [current plan terms](https://vercel.com/docs/plans/hobby) before a commercial launch. This repository contains no billing integration or automatic paid-tier upgrade.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests use real Better Auth sessions and PostgreSQL-compatible storage. They cover account isolation, persistence, Origin checks, token rotation, model eligibility, revision binding, bounded report uploads, secret redaction, scoring, connector-to-API synchronization, persistent job leases/dedupe, cancellation, retry caps and secret-isolated fixed-command execution. No paid model calls are required.

## Boundaries of this release

- Hosted web QA is configured directly on the website: verify an encrypted OpenRouter key, choose models, save a public disposable preview and trusted goals, then request QA. No connector or customer-managed machine is required. The shared pilot permits two concurrent jobs and eight starts per month, with 15-minute workers. Model billing uses the connected OpenRouter account.
- Email links establish inbox ownership, not repository ownership. Billing, SAML/SCIM and GitHub OAuth installation are not enabled in this beta. Password recovery retains the configured second factor and revokes existing sessions and pending login challenges.
- Registering a repository grants no GitHub access. A project token reads its project’s settings, claims locally enrolled jobs and submits reports; it cannot read another account’s data.
- Report scores are `floor(passed required checks / all required checks × 100)`. No required checks means no score. Failed, blocked, skipped, unsupported, and pending checks cannot count as passed. High-severity AI findings require review even when checks pass.
- AI findings are unverified suggestions. A score is neither test coverage nor a guarantee that a product is bug-free.
- Reports include bounded summaries and may contain product information. Product source files, patches, raw logs, transcripts, screenshot bytes, and provider keys are excluded from report uploads. Test source that you explicitly author in the test library is stored and sent to the enrolled runner when enabled. Pattern-based redaction cannot guarantee removal of every sensitive detail.
- Evidence uploads require explicit owner opt-in and are retained encrypted with expiration. Without opt-in, detailed evidence remains ephemeral on hosted workers or on the private runner. GitHub comments and release decisions remain in the QA engine’s existing workflow.
- The current engine’s supported execution paths and browser coverage are documented in its repository. This website does not add native-app testing or exhaustive coverage for every technology stack.

## Architecture

Next.js / React → Better Auth → PostgreSQL. Account APIs enforce product membership and role permissions. Separate project tokens are hashed in the database. The runner connects outbound over HTTPS; model inference and test execution stay in the QA engine’s environment. The web server never executes product PR code.

The source is MIT licensed. Provider models, hosting, and runner infrastructure have their own terms and costs.

## Builds, versions and deployment gates

Choose a pull request, CI build or complete release from Overview. Builds/releases need their actual artifact SHA-256, source commit, platform and build/version name. They do not require a PR. Update both the connector and engine, then locally enroll `allowedPlatforms`, `releaseManifestDir` and `executeBaseline` before executing these jobs. The [engine release guide](https://github.com/Vaidehi2510/QA-testbot/blob/main/docs/releases.md) documents the builder manifest, platform suites and the local deployment gate.

The website stores and displays evidence; the engine CLI gate can rehash the private local artifact before deployment. Project-token callers can also query `/api/agent/release-gate` with `recordId`, `revision`, `kind`, `name`, `platform` and `artifactSha256`. That lookup verifies report identity, required gates, findings and one-hour freshness; it cannot inspect the private artifact. CI must invoke the gate before its own deployment command. No product deployment or source edit happens through the portal.

The test library supports Node execution only after local `allowWorkspaceTests: true` enrollment; other framework drafts export to your own CI and JUnit import path. New jobs snapshot enabled test source/digests. Product membership and role permissions protect test source, and editing/deleting a saved case cannot alter already queued jobs. At most eight enabled Node tests totaling 96 KB can be included. The source is never executed by the website.

See [platform coverage](https://patchsentry.vercel.app/coverage) and the [sourced comparison](https://github.com/Vaidehi2510/QA-testbot/blob/main/docs/comparison.md) for scope and remaining gaps.

## Team operations

Owners, admins, QA engineers and viewers have distinct API-enforced roles. Invitations are verified-email-bound, single-use and expire in seven days; share their one-time code privately. Each product can opt into Slack lifecycle updates without storing bot tokens on the website. A connector needs both local `teamUpdates` enrollment and `--slack-updates`; add `--github-context` and a read-only GitHub token for pinned author/releaser metadata. Worker fleets default to one job per product and support explicitly selected concurrency up to eight across compatible workers. See the [full setup and limits](https://github.com/Vaidehi2510/QA-testbot/blob/main/docs/team-operations.md).

## Passwords and required two-step verification

Signup verifies email once, then routes to `/auth/setup` for password creation and mandatory second-factor enrollment. Email codes use the existing Gmail sender; authenticator enrollment supports Google Authenticator, Microsoft Authenticator and other standard TOTP apps via a locally rendered QR code or manual key. Authenticator users receive ten single-use recovery codes. SMS is deferred until an SMS provider is selected/configured.

Every owner/admin password login requires its selected factor. QA engineers and viewers may use a previously MFA-verified, unexpired remembered browser; all other logins require their factor. Raw native trust-device flags, factor disabling and passwordless login bypasses remain blocked. Server-side `qa_auth_proofs` gate all user/project APIs; holding an email-verified or password-only session is insufficient. Native Better Auth routes are allowlisted, and sessions require actual MFA or a server-validated remembered-browser proof appropriate to current project roles. Email codes are hashed, expire in five minutes and permit five attempts per issued code. Authenticator secrets and recovery codes use Better Auth encryption, with account lockout, request throttling and additional short-lived code replay protection. Password hashes use Better Auth’s password implementation. No password, QR secret or code is sent to a QA model.

Existing projects and memberships are preserved. Existing users must finish password/MFA setup before using the website; old sessions have no assurance proof. Previously issued automation project tokens remain separate credentials and continue to require an email-verified Patchsentry owner; issuing/rotating a token through the UI requires full password + MFA assurance.

For recovery, `/reset-password` accepts a single-use email reset token, revokes active sessions and in-flight login challenges, and returns the user to password + MFA login. Password reset never disables the factor. Authenticator recovery codes must be saved during setup; automatic second-factor resets are intentionally not exposed. New security tables are added through the production migration wrapper.


## Accounts, teams and architecture

The in-app name menu opens **My account**, with profile editing, password changes, two-inbox email changes, session revocation, remembered browsers and workspaces. Password/email changes require actual MFA within 15 minutes, plus the current password. Both email-change links expire after ten minutes; the address remains unchanged until the current and new inboxes confirm. Completing a change revokes sessions, pending challenges and remembered devices. Changing a password revokes other sessions and remembered devices too.

QA engineers and viewers can choose to remember a browser for 30 days after real MFA. An opaque HttpOnly cookie, a server-side hashed trust record and Better Auth's signed device cookie are required in addition to a valid password. Trust is bound to the account and browser user-agent, not a claimed hardware fingerprint. A different browser, expired/revoked record, missing cookies or password recovery requires MFA again. Users owning or administering any project always complete MFA at every password login. Promotions invalidate device trust and cannot convert a remembered session into administrative access. This policy is global across an account's project roles. Remembered browsers can be revoked in My account; sign out other sessions to terminate existing sessions too.

**Patchsentry roles do not map automatically to GitHub roles.** A project creator is its Patchsentry owner, not a verified GitHub repository owner. Only that owner issues runner tokens, deletes the project, or appoints/changes admins. Admins configure models/preview/Slack and manage QA engineers/viewers; QA engineers author tests and request runs; viewers read reports/tests. Repository admins or authorized delegates separately provision a read-only product connection. Neither typing a repository name nor accepting a Patchsentry invitation grants GitHub access. Do not treat this UI as a GitHub ownership verifier.

Invitations now send through `AuthConfig.sendInvitation`, configured from the existing Gmail SMTP sender in production. The API records `accepted` only after the mail server accepts the message; it does not guarantee inbox delivery. Missing senders and unconfirmed attempts remain visible. No automatic email retry is made. A backup code is shown once; tokens remain hashed in storage, expire in seven days and are bound to the recipient's verified email. Invitation links use fragments to keep tokens out of HTTP request URLs. Recreating an invitation invalidates the previous link. `/invite` retains the token only in that browser tab until acceptance or dismissal.

Owners/admins may associate a work domain with a project in My account by publishing its project-bound DNS TXT challenge at `_patchsentry.<domain>`. New challenges expire in 24 hours; verification stores a timestamp, not a permanent guarantee of domain control. This identifies the workspace, but does not enable automatic joining, SSO, custom hostnames or repository authorization. Workspace links remain private and membership checked.

See the public [architecture guide](https://patchsentry.vercel.app/architecture): `QA-testbot` is the runner engine; `patchsentry-web` is the website, connector and current report backend. `Patchsentry-Ledger-Java` is a separate optional Spring Boot report service. The current website and connector do not call Ledger; integrating it requires an explicit API/auth adapter. Ledger deployment is not a prerequisite for current QA runs.

## Hosted execution

See [hosted QA](docs/hosted.md) for the SaaS flow, supported scope, operational limits and deployment verification. Local model and private-network connectors remain optional.
