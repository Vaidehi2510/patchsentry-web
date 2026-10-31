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

Production code revision `37e9fbad475dae4a7d4df2c1abfbc6b18b2908bb` deployed successfully to https://patchsentry.vercel.app after excluding the local-only fixture harnesses from the production source package. Its GitHub CI passed. Read-only production probes returned 200 for home/docs and 401 for unauthenticated Ledger history/operator health. No customer account, live QA execution or notification was triggered by these probes.

## Launch milestone follow-up (same date, latest deployed baseline)

This milestone starts from website `e067162` / deployed code `37e9fba`, engine
`d0ae18a`, Java `6a15e90`; earlier sections above are historical results. The
existing architecture, optional Java archive and project defaults are preserved.
All new evidence under `docs/evidence/launch` is **internal development validation**.

### Actual authorized release workload

The owner authorized Patchsentry's own release QA. `test/launch/workload-cases.json`
registered labels and exact mutations before execution (manifest SHA-256
`7569ecc6bdd7da56175e31ed1e25ad1b66a811840ba77176cb9bdf3ed564cde1`). The
baseline is its existing CI/tool-assisted backend release suite; the same tests
run inside bounded, offline Node24 containers over read-only source copies.
This is an actual product workload with **seeded code defects**, not observed
customer incidents or a blinded independent held-out study.

Initial results: domain-lookalike and offboarding-bypass mutations detected;
retained-payload integrity and remote-receipt validation mutations missed.
**2 detected / 2 missed / 4 valid defect cases; zero alarms in two healthy cases.**
No invalid syntax/infrastructure trials were counted as detections. Both passing
healthy variants and repeated critical-suite runs were consistent; that small
sample does not establish a product-wide flaky-test rate. Existing bug-check code
was present: the misses were missing adversarial regression assertions.

`test/ledger-integrity.test.ts` now checks validly encrypted plaintext against the
immutable receipt digest, and individually rejects wrong archive project, record,
digest and acknowledgment. Replaying the **two original misses** after adding
those tests detected both; healthy release176/176 passed. These are post-discovery
regressions, **not a revised 100% held-out recall claim**. Original results remain
in `evaluation.json`; follow-up results remain separately labeled.

Measured workload process times, exit codes, check counts and log hashes are
retained. Setup/maintenance/triage/approvals and total human intervention have no
authentic time log; those metrics remain null. There is no measured manual baseline,
no demonstrated staffing saving and no claimed reduction relative to manual QA.
AI diagnosis is separate and **not executed**: no locally authorized OpenRouter
key or running local inference service was available. Deterministic assertions,
mocked model replies and suite execution cannot establish AI diagnostic accuracy.
The next AI experiment must freeze labels, model/version, context and a maximum
call/token/dollar budget before running; diagnosis correctness and suggested-fix
validity must be adjudicated independently of test pass/fail.

### Skipped and fixture-only inventory

| Capability | Completed with available access | Remaining validation |
| --- | --- | --- |
| Engine Docker Go/Vitest and authored Node suites | Both previously skipped tests passed offline with unchanged source, no integration environment and bounded scratch. New pinned `tools/test-image` recipe is built/tested; engine CI now prepares it before setting both image flags. | CI execution on GitHub is reported separately from local success. |
| Engine browser flows | Chromium, Firefox and WebKit flags enabled; full engine run338 passed/zero skipped before recipe addition. | Company browsers/devices, real cloud network enforcement and product-specific journeys. |
| Website identity and roles | Signed OIDC tokens, cookie state/nonce/audience/issuer, MFA, linking, Entra enforcement and SCIM lifecycle tested in local fixtures. | Real company tenant provisioning, synchronization timing and administrator recovery. |
| AWS devices | Compatibility, type/account/project checks, cancellation, ambiguous scheduling and bounded ingestion exercised by injected SDK responses. | Actual physical-device run, cancellation and results; AWS upload bytes remain an explicit provenance boundary. |
| Capacity | Real PostgreSQL concurrent claims plus actual Node24 release tests; queue and budget regressions. | Real hosted microVM/browser load and observed provider bills; no quota/budget increased. |
| Recovery | Real local dump/restore, encrypted artifacts, prior-source compatibility and killed QA process. | Production-size Neon restore, deletion replay/key escrow and actual Vercel traffic rollback. |
| Java archive | Preserved prior real local HTTP/datastore evidence and new mismatch regressions. | Deployed service, company token and actual retained remote acknowledgments. No service deployed by this milestone. |
| Email/Slack | Existing rendering/enrollment/uncertain-send checks remain fixtures; no messages sent. | Company-approved end-to-end delivery, including current restricted-domain delivery prohibition. |
| AI | Existing provider/budget interfaces retained; deterministic challenge explicitly separates inference. | Secure model connection and approved bounded evaluation. No paid calls or fabricated diagnosis. |
| Independent security | Reproducible package, trust-boundary map and finding template prepared. | Named external assessor and authentic findings. Internal review stays internal. |

There are no conditionally skipped website `*.test.ts` checks in this milestone.
A passing suite contains mocked/fixture boundaries listed here; zero skips is not
proof those external services were exercised. The read-only access discovery did
not export or inspect encrypted production project connections.

### Configuration versus validation

The existing Release policy screen includes an owner/MFA-approved `enterprise-v1`
profile. It verifies stored prerequisites, versions and current configuration,
records its digest in the existing Ledger and detects drift/expired repository
proof. It requires verified restricted domain, enforced tenant-pinned Entra,
SCIM enrollment and fresh administrator authorization. It approves selected models,
sets evidence/report/audit retention floors30/90/365 days, requires reviewed security,
SSO/offboarding evidence, retained evidence, known costs and separate held-out
qualification. Physical-device evidence and Java acknowledgment are explicit
product choices. Budgets/backends remain unchanged. The profile stays advisory;
an already-enforced project must explicitly return to advisory first.

**Production activation not claimed.** No owner opted any real project into this
profile or fair scheduling. Stored configuration verification, actual provider
interoperability, independent platform security and individual release eligibility
are separate criteria. Reviewed document records alone cannot certify a platform.

### Minimum real-provider completion steps

**Entra — company identity administrator (any verified company domain).** Register
an application limited to that company's tenant; set Web redirect
`https://patchsentry.vercel.app/api/enterprise/callback`. The implemented request
uses authorization code+PKCE and `openid profile email`, not directory-wide Graph
read/write permissions. Enter tenant/client IDs and the secret through the
owner/MFA-protected Enterprise access form. Verify/restrict the domain first.
Explicitly link test owner/member identities, then enable required SSO. Use a
non-gallery provisioning application with the project SCIM URL shown by the UI and
the scoped directory token; map stable object ID to externalId, verified email to
userName, and active state. Do not enable unsupported Group synchronization.
Microsoft documents an Application Administrator for this provisioning setup;
company tenant policy and licensing must be checked by that administrator.
[Microsoft SCIM setup](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups).

Retain dated provider provisioning logs plus authenticated API outcomes for:
new sign-in/link, wrong tenant, password-only bypass denial after enforcement,
member deactivation with pre-existing password/SSO/trusted-device sessions,
next-request report/evidence/history denial, reactivation without role escalation,
recycled email/object-ID refusal, and authorized owner recovery. Record actual
provider-to-application offboarding delay separately from next-request denial.
The fixture does not establish Entra synchronization delay. Required artifacts:
redacted sign-in/provisioning run IDs, test account roles, timestamps, before/after
responses, reviewer identity and hashes; never tokens or raw personal data.

**AWS — company AWS administrator and disposable app/build owner.** Use an already
approved Device Farm project/pool in `us-west-2`, temporary credentials entered
only in the protected form, two accepted app/Appium Node package uploads and an
explicit device-minute budget. The integration calls only GetProject, GetDevicePool,
GetDevicePoolCompatibility, GetUpload, ScheduleRun, GetRun, ListJobs, ListArtifacts
and StopRun. Scope their IAM resources to the selected account/project/pool/uploads
and its run/job descendants; no CreateProject, administrator policy or PassRole is
requested by this implementation. An administrator must validate resource support
against the [AWS authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_devicefarm.html)
and the supplied deny-by-omission policy template before issuing access.

Run a healthy and a known-defect test on actual physical devices; retain source
commit, build ID/version, immutable app/test hashes, accepted upload ARNs, actual
run/device IDs, timestamps, results and device minutes. Cancel one approved run;
verify provider termination and portal ingestion. Simulate client timeout only
with an administrator watching provider state; reconcile the exact named run,
without creating a second paid attempt. Confirm no cross-project/account artifact
access and check actual billing. AWS metadata does not independently prove uploaded
bytes: provide CI-bound source/build/artifact evidence before any release-gate
qualification; the submitter's SHA declaration alone remains insufficient.

**Hosting/database operator.** Approve remaining capacity and a monitored drain
trigger, reconcile provider usage/bills, then run bounded actual hosted loads. Supply
an isolated production-size backup copy and escrowed test keys, recovery owner and
provider rollback access. Verify deletion replay and measured RTO/RPO before making
production commitments. Never run destructive recovery against production.

**Evaluation owner.** Connect OpenRouter in the secure web setup (or an authorized
local endpoint), record inference-check success and approve a fixed evaluation
budget/model. Supply authentic workload/time logs and independent labels to measure
misses, triage, maintenance and human work. No staffing claim follows from speed.

**Independent reviewer.** Accept the package and authorized staging scope; perform
the assessment and return dated findings with reproductions, severity, affected
revision and closure/retest evidence. No independent findings are available now.

AI preparation is executable without inference:
`PATCHSENTRY_ENGINE_DIR=/reviewed/engine node tools/launch/ai-diagnosis.mjs`.
It builds six redacted, bounded source inputs with neutral case IDs and no expected
labels/outcomes. Preparation digest is retained in the evidence record. To run,
an evaluation operator must approve a config file containing that digest, backend,
model, maxCalls(1–6), maxCostUsd(0–10), and optional enrolled local profile. Use
`PS_AI_CONFIG`, `PS_AI_OUTPUT` and `PS_APPROVE_AI_EVAL=1` with `--run`; credentials
stay in the authorized process environment, never arguments or chat. Prefer the
existing protected product setup for company QA credentials; this operator harness
does not export a key from it. Loopback-only local evaluation is supported.
Known catalog pricing is required before an OpenRouter call; attempted reservations
are persisted before dispatch, retries/fallbacks are off, unknown charges halt
further calls. No existing attempt file is reused for fresh paid work. Outputs
need a separate reviewer to judge diagnosis and fix validity; the script never
applies a fix or grants a release gate. Preparation itself is not AI validation.

### Final regression and receipt record

Final website: **177 passed, zero failed/skipped**, including owner/admin/viewer/
outsider authorization for the opt-in template. The complete final suite also ran
on bounded offline **Node24:177/177**,47.321s. Type checking and production build
passed. Final UI used real local Chromium and the built site with synthetic API
transport: default profile inactive, consent present, missing prerequisites prevent
activation, zero detected axe violations/console errors and no horizontal overflow
at1440/390/320px. This does not validate a real company's sign-in.

Final engine: **338 passed, zero failed/skipped**, both browser flags and both pinned
Docker images enabled,42.065s. The image recipe uses public digest-pinned Node24 and
Go1.26.8 plus locked Vitest5.0.3; CI prepares dependencies separately from offline
execution. Published engine `5c1114bdbdd5cb89ed2c1d78580d27b8da1e0c9b` has no runtime
source change from `d0ae18a`. Its [GitHub verification run](https://github.com/Vaidehi2510/QA-testbot/actions/runs/41162184547)
succeeded. The QA controller remains `disabled_manually`; it was not re-enabled.
Current production dependency audits for engine/website and fixture-image lock
reported zero advisories. That is not independent vulnerability assessment.

The final queue interruption recheck also wrote a frozen pool/company quota
snapshot through the actual capacity Ledger event; PostgreSQL accepted the added
columns. Recovery-controller time6ms (initial run5ms); no interrupted job passed
and a different tenant progressed. Load measurements precede this additive audit
snapshot addition; no new throughput improvement is inferred from it.

`docs/evidence/launch/ledger-receipt.json` binds18 exact evidence artifacts through
the existing Ledger implementation in a synthetic project. The encrypted retained
payload matched its immutable digest; its receipt chain/head verified. This is an
internal validation event, never a passing assessment, company qualification,
production customer record or deployed Java acknowledgment. Retain the receipt
outside the database. Source manifests and artifact hashes allow a reviewer to
identify the exact measured candidate rather than infer provenance from a label.

Website main code `fdbe16c` passed [GitHub verification](https://github.com/Vaidehi2510/patchsentry-web/actions/runs/41162940145)
and the existing Vercel production build (additive migration completed). The
production alias is live and public home/docs/signup returned200. Unauthenticated
capacity/operator/drain/profile/history probes returned401. Deployment identity
and prior rollback target are in `enterprise-evidence.json` / launch checkpoint.
These are health/authentication probes, not a real-company production qualification.
