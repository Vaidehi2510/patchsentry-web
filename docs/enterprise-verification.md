# Enterprise verification record — 2026-10-30

This records development verification, not independent assurance. Baseline:
website `4c6cae5`, engine `4b5fac3`, Java `6a15e90`. Engine release candidate:
`d0ae18ab0311aff75d4b4c8394670c9a671f5a49`; website pins that exact revision.
Website release commits are recorded in Git history and deployment output.

## Reproducible layers

| Layer | Command / evidence | Boundary |
| --- | --- | --- |
| Website baseline | `npm test`: 149 passed | PGlite, fixtures and local connector process tests; not a live company. |
| Website hardening | `npm test`: 165 passed; `npm run typecheck` and `npm run build` passed | Includes signed OIDC fixtures, tenant/role checks, archive outage/corruption/retry controls, version history, offboarding, time-accounting and omitted-check rejection. |
| Engine baseline | `npm test`: 326 passed, 9 skipped | Real-browser opt-in checks initially disabled. |
| Engine candidate | `QA_PORTAL_BROWSER_TEST=1 QA_AUTONOMY_BROWSER_TEST=1 npm test`: 336 passed, 2 skipped | Real local browser checks enabled. Two tests require separately enrolled Docker framework images and remain unverified in this run. |
| Java Ledger | Maven `verify` in `maven:3.9-eclipse-temurin-21`, Docker Testcontainers | 40 passed; real disposable Postgres 16 / Mongo 7 / Redis 7. No Java production deployment. A separate real local HTTP check confirmed two PR/release archives and receipt reconciliation. |
| Dependency advisories | `npm audit --omit=dev --json` in website and engine | Zero advisories reported during this verification; not proof of absence of vulnerabilities. |
| Public TodoMVC | Prior pinned public source `ff43b02e59dfa604386bb382034b2cd07c2bcd8a`, retained benchmark | 78 targeted matched outcomes, including repeated browser variants. Not 78 product-wide passes; not rerun as a customer qualification. |
| Controlled operational workflow | `PATCHSENTRY_ENGINE_DIR=/path/to/QA-testbot PS_E2E_OUTPUT=/new/fixture/output node --import tsx scripts/enterprise-e2e-fixture.ts` | Real local Chromium, screenshots and UI/API/data assertions. GitHub and Java HTTP responses are injected fixtures. |
| PostgreSQL restore | `enterprise-restore-fixture.ts seed/verify`, `pg_dump` + `pg_restore` into another database | Actual local Postgres backup/restore of synthetic records, Ledger payloads, evidence, baseline and encrypted provider credential. No production RPO/RTO proof. |
| Browser UX | Synthetic fresh account/project, real local production build: pilot/time-log controls and downloads passed; zero detected axe violations, no overflow at 390/320px | Does not send verification email or claim Gmail/Entra/AWS interoperability. |

## Controlled application labels and outcomes

The workflow writes the labels before execution and commits each predefined
fixture mode in a disposable source repository. QA leaves that repository clean.
It signs duplicate PR events, freezes a plan, leases work, executes real browser
checks and replay, uploads digest-verified screenshots, acknowledges the lease,
retrieves a signed assessment decision, exercises Java outage/recovery and retrieves
Ledger history under project authorization.

| Case | Expected outcome | What it establishes |
| --- | --- | --- |
| Healthy checkout | Passed assessment | Correct created order amount/owner and denied viewer administration |
| Wrong stored amount | Failed | UI success is insufficient when API/resulting data is incorrect |
| Permission defect | Failed | A viewer receiving an administrative response is detected |
| Async missing state | Failed | A “created” UI notification without the resulting order is detected |
| Wrong revision | Blocked | Unbound screenshots/outcomes cannot be assigned to the requested commit |
| Worker interruption | Blocked | Expired lease becomes an explicit infrastructure failure and not tested coverage |

All six targeted outcomes matched. There are **three distinct seeded product
defects**, ten browser/replay executions over five browser-assessed variants, one
identity-control scenario and one interrupted-worker scenario. Eight protected
screenshots were retained across the healthy/defective variants; the wrong-revision
variant did not supply bound screenshots. Signed duplicate deliveries reused work;
archive outage did not become a confirmed delivery; stale assessment attempts and
cross-project history lookups were denied. No model was called, so AI diagnosis
quality was not evaluated. Full run output is an ignored local artifact, not
customer evidence or production qualification.

The controlled run recorded roughly seven seconds on this development machine;
this is an observed small-fixture runtime, not a service latency promise. Known
inference usage is zero because there were no model calls. Infrastructure cost
and authentic human intervention/maintenance time remain unmeasured. No manual
comparison was performed, so staffing impact and monetary savings are unknown.

## Recovery evidence

The local PostgreSQL dump restored into a different empty fixture database and
preserved nonempty membership/usage counts, Ledger head/chain, decryptable Ledger payloads, an encrypted
evidence file, visual baseline and fixture provider credential. A repeated additive
migration preserved those values and the append-only guard. The first verification
reported 75 ms for the **verification step only**; backup/restore/operator recovery
time was not measured. This small exercise does not validate Neon backup retention,
region recovery, production scale, key escrow or deletion replay.

## Explicitly unverified

Real company Entra login/provisioning/offboarding, physical AWS devices and upload
identity, cloud enterprise capacity and billing, production backup restore,
independent penetration assessment, real customer held-out defect recall, live
email/Slack delivery and model diagnosis quality require authorized external
accounts/evidence. Saving configuration is never counted as validating them.
