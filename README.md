# Patchsentry

A public product website and private QA workspace for [QA-testbot](https://github.com/Vaidehi2510/QA-testbot). Inspect pull requests, choose OpenRouter or local models, and see required-check scores, blockers, findings, and suggested fixes in one place.

[Visit Patchsentry](https://patchsentry.vercel.app) · [Explore the demo](https://patchsentry.vercel.app/demo) · [Integration guide](https://patchsentry.vercel.app/docs)

The website is the control and reporting interface. The separate QA engine executes checks on a trusted runner. It can read product source and publish PR comments, labels, and statuses; it never edits, pushes, or merges product code.

## What is implemented

- Responsive product, workflow, security, and integration documentation pages.
- A clearly labeled interactive demo; demo metrics never appear as real customer results.
- Persistent email/password accounts, secure session cookies, and database-backed login rate limits.
- Account-scoped projects, reports, model settings, and one-time runner enrollment tokens.
- A live OpenRouter catalog with context sizes, tool/vision capabilities, and pricing.
- Local model inventories reported by an outbound connector; the website never contacts users’ localhost servers.
- A default model or separate model for each of five QA roles, with per-run budget and call limits.
- Revision-specific PR reports, transparent required-check scores, and unverified AI findings.
- A working [outbound runner connector](docs/agent.md) that syncs reports and, with explicit local enrollment, applies model choices to the bot configuration.

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
4. Clone this website repository on that runner and start the connector:

```sh
export QA_PORTAL_URL="https://YOUR-SITE.vercel.app"
# Set QA_PORTAL_TOKEN using the runner's secret manager.
node scripts/agent.mjs --bot-dir /path/to/QA-testbot --watch --apply-model-settings
```

5. Keep `OPENROUTER_API_KEY` or `LOCAL_MODEL_API_KEY` on the runner. Select models on the website. The runner applies these choices within its locally enrolled backend, image, and spending policies.
6. Execute QA with the engine’s existing workflow or CLI. This connector neither activates nor schedules the QA engine. Reports appear on the website when results are synchronized.

See [the connector guide](docs/agent.md) for GitHub-hosted state, local capabilities, cross-backend enrollment, report sharing, and exact command options.

## Deploy

Deploy this repository as a Next.js application. Vercel configuration is detected automatically. Attach a persistent PostgreSQL database and set these **server-only** environment variables:

| Variable             | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string with TLS     |
| `BETTER_AUTH_URL`    | Exact public HTTPS origin, without a path |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters   |

Run `npm run db:migrate` with these variables exported, then deploy. Migrations do not run during ordinary API requests. Production fails closed if persistent account storage is unavailable; the public product site and demo remain available.

Never deploy with `PGLITE_DATA_DIR`. Vercel serverless disk is not a persistent database. Keep preview deployments separate from production data and configure their own exact auth origin when enabling accounts there.

Deploy from the CLI with `npx vercel deploy --prod`. Automatic deployments from GitHub require connecting the GitHub account in Vercel’s login connections and linking this repository. `.vercelignore` excludes all local environment files, development databases, and test artifacts from CLI uploads. Set `SITE_URL` if using a different public domain.

Free hosting/database tiers have limits. Vercel Hobby is restricted to personal, noncommercial use; review the [current plan terms](https://vercel.com/docs/plans/hobby) before a commercial launch. This repository contains no billing integration or automatic paid-tier upgrade.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests use real Better Auth sessions and PostgreSQL-compatible storage. They cover account isolation, persistence, Origin checks, token rotation, model eligibility, revision binding, bounded report uploads, secret redaction, scoring, and connector-to-API synchronization. No paid model calls are required.

## Boundaries of this release

- No unattended QA service is provisioned by signing up. A trusted runner and the QA engine must be configured for each product.
- Email verification, password-recovery email delivery, billing, team invitations, and GitHub OAuth installation are not enabled in this beta. Save your password securely. Accounts do not establish verified email or repository ownership.
- Registering a repository grants no GitHub access. A project token only reads its project’s settings and submits its reports; it cannot read another account’s data.
- Report scores are `floor(passed required checks / all required checks × 100)`. No required checks means no score. Failed, blocked, skipped, unsupported, and pending checks cannot count as passed. High-severity AI findings require review even when checks pass.
- AI findings are unverified suggestions. A score is neither test coverage nor a guarantee that a product is bug-free.
- Reports include bounded summaries and may contain product information. Source files, patches, raw logs, transcripts, screenshot bytes, and provider keys are excluded. Pattern-based redaction cannot guarantee removal of every sensitive detail.
- Detailed evidence stays on the runner. GitHub comments and release decisions remain in the QA engine’s existing workflow.
- The current engine’s supported execution paths and browser coverage are documented in its repository. This website does not add native-app testing or exhaustive coverage for every technology stack.

## Architecture

Next.js / React → Better Auth → PostgreSQL. Account APIs enforce owner-scoped queries. Separate project tokens are hashed in the database. The runner connects outbound over HTTPS; model inference and test execution stay in the QA engine’s environment. The web server never executes product PR code.

The source is MIT licensed. Provider models, hosting, and runner infrastructure have their own terms and costs.
