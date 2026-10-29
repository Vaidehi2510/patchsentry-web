# Patchsentry

A public product website and private QA workspace for [QA-testbot](https://github.com/Vaidehi2510/QA-testbot). Inspect pull requests, choose OpenRouter or local models, and see required-check scores, blockers, findings, and suggested fixes in one place.

[Visit Patchsentry](https://patchsentry.vercel.app) · [Explore the demo](https://patchsentry.vercel.app/demo) · [Integration guide](https://patchsentry.vercel.app/docs)

The website is the control and reporting interface. The separate QA engine executes checks on a trusted runner. It can read product source and publish PR comments, labels, and statuses; it never edits, pushes, or merges product code.

## What is implemented

- Responsive product, workflow, security, and integration documentation pages.
- A clearly labeled interactive demo; demo metrics never appear as real customer results.
- Verified, passwordless email-link accounts, secure session cookies, and database-backed login rate limits. Accounts are created only after a link is verified.
- Account-scoped projects, reports, model settings, and one-time runner enrollment tokens.
- A live OpenRouter catalog with context sizes, tool/vision capabilities, and pricing.
- Local model inventories reported by an outbound connector; the website never contacts users’ localhost servers.
- A default model or separate model for each of five QA roles, with per-run budget and call limits.
- Revision-specific PR reports, transparent required-check scores, and unverified AI findings.
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

## Connect a product

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

Personal, school, and work email addresses can all create accounts. No company domain is required. A user requests a link, receives a branded email, then opens its single-use link within ten minutes. Requesting a link does not create a user or session. Password registration and password login are disabled. Existing unverified accounts must prove inbox ownership; their previous sessions are revoked when they verify. Existing beta project tokens must be regenerated in Integrations after verification. Projects and reports are preserved; a token issued before mailbox verification cannot regain access after the account is verified.

For a free beta sender without purchasing a domain, create a dedicated Gmail account, enable 2-Step Verification, and generate an app password at <https://myaccount.google.com/apppasswords>. Add `SMTP_USER` and `SMTP_PASSWORD` directly in the hosting provider's server-only environment settings. Gmail SMTP uses authenticated TLS on port 465. Never commit these values or add a `NEXT_PUBLIC_` prefix. Gmail applies its own delivery limits; use a dedicated transactional provider for a larger rollout. Resend can be added later with a domain you control.

If mail delivery is unconfigured, signup and login show a clear setup notice and link to the interactive demo. Delivery failures cannot create accounts or pretend to have sent a link. Verification tokens are stored hashed, expire in ten minutes, and are consumed atomically. Automated tests capture email in memory; production has no console-mail or verification bypass.

### Readability and motion

The sage and lavender interface supports independent builders and team-owned products. Inputs use at least 16px text, common controls have larger tap targets, and responsive layouts preserve readable text on mobile. Scroll reveals, workflow signals, and preview animations have a persistent pause control and honor `prefers-reduced-motion`. Content remains visible without animation support. Team products are managed by the project account owner; shared membership and invitations are not implemented.

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

- No unattended QA service is provisioned by signing up. A trusted runner and the QA engine must be configured for each product.
- Email links establish inbox ownership, not repository ownership. Billing, team invitations, and GitHub OAuth installation are not enabled in this beta. Password recovery is unnecessary for passwordless accounts.
- Registering a repository grants no GitHub access. A project token reads its project’s settings, claims locally enrolled jobs and submits reports; it cannot read another account’s data.
- Report scores are `floor(passed required checks / all required checks × 100)`. No required checks means no score. Failed, blocked, skipped, unsupported, and pending checks cannot count as passed. High-severity AI findings require review even when checks pass.
- AI findings are unverified suggestions. A score is neither test coverage nor a guarantee that a product is bug-free.
- Reports include bounded summaries and may contain product information. Source files, patches, raw logs, transcripts, screenshot bytes, and provider keys are excluded. Pattern-based redaction cannot guarantee removal of every sensitive detail.
- Detailed evidence stays on the runner. GitHub comments and release decisions remain in the QA engine’s existing workflow.
- The current engine’s supported execution paths and browser coverage are documented in its repository. This website does not add native-app testing or exhaustive coverage for every technology stack.

## Architecture

Next.js / React → Better Auth → PostgreSQL. Account APIs enforce owner-scoped queries. Separate project tokens are hashed in the database. The runner connects outbound over HTTPS; model inference and test execution stay in the QA engine’s environment. The web server never executes product PR code.

The source is MIT licensed. Provider models, hosting, and runner infrastructure have their own terms and costs.
