# Current release checkpoint — 2026-10-30

Starting revisions: website `4c6cae5b084fbd3536f026542269d5f7f602fba6`, engine
`4b5fac3677e13ef466b5ecc3d9dd94cdf391b3a1`, Java Ledger `6a15e90`.
Isolated branch: `enterprise-hardening-20261030` in both working checkouts.
Existing engine `.DS_Store` is unrelated and preserved. No Apollo source or upstream
former-employer repository was inspected or changed.

Engine `d0ae18ab0311aff75d4b4c8394670c9a671f5a49` is published to existing main;
website pins this exact revision. QA controller remains `disabled_manually`.
Java source did not need another API revision; its 40 Maven tests passed against
real disposable Postgres/Mongo/Redis, and hardened website delivery plus receipt
reconciliation passed against the real local Java HTTP service.

Website implementation: additive Ledger claims/destination binding/ack gate,
versioned definitions/tests/usage/bugs/visual approvals, frozen job context,
server-recomputed execution scope and exact freshness/current configuration,
SCIM identity binding and effective manual/owner offboarding, opt-in automatic
triage, retry reservations, recovery/health/fair scanning, temporary exceptions,
opt-in stale-event refresh, held-out/distinct-defect metrics, time logs and scoped
release-history exports. Navigation and hosted Ledger are reused.

Verified baseline: 149 website tests; engine 326 passed/9 skipped. Candidate
engine: 336 passed/2 skipped with real-browser flags. Last website suite:
165 passed. Qualified positive gate, changed config/stale gate, exact-version and
corrupt evidence regressions are included. Both production dependency audits
reported zero advisories. Final type/build/browser checks are retained locally.

Controlled workflow: six expected outcomes matched, including three seeded
resulting-data/permission/async defects, one identity block and one worker expiry.
Real Chromium and screenshots; GitHub and Java transports are fixtures in this
workflow. A separate Java HTTP test uses actual local services. PostgreSQL dump
restored into another empty local fixture database, preserving nonempty membership,
usage/history, Ledger/evidence/baseline/credential decryption. Production recovery
and staffing savings remain unmeasured. AI was not called in this evaluation.

First local UI check hit a stale Next build server serving an old chunk after a
build; restarting the server resolved it. A real HTML pattern incompatibility was
then found and fixed in the sample-ID and repository-name forms. Final UI checks passed with zero detected axe violations, 390/320px overflow checks and no JavaScript/invalid-pattern errors. Use a completed build and a restarted server, never rebuild under it.

Release files: `enterprise-readiness.md`, `enterprise-operations.md`,
`enterprise-verification.md`; controlled harnesses in `scripts/enterprise-*.ts`.
Final website commit/deployment revisions belong in Git/deployment output. Keep
all new flags opt-in; do not enable customer enforcement or send notifications.
Clean up only the disposable fixture containers and local preview server.

External blockers: company Entra/AWS credentials and authorized pilots, independent
assessor, real customer held-out/manual baseline, cloud quota/billing/monitoring
and production backup/restore ownership. No additional paid capacity, credentials,
external notifications or customer-data testing was used to invent completion.

Implementation commit: `bb9e790`. Engine GitHub verification passed. Final release evidence and operator documents are committed separately.
