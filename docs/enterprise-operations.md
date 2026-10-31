# Deployment, operation and recovery

## Release ordering and compatibility

1. Preserve the recorded baseline revisions and export an independently retained Ledger head for important projects. Check both working trees for unrelated changes.
2. Publish the tested engine commit first. The website pins `scripts/hosted-engine-revision.txt`; hosted workers never clone a floating engine head for execution.
3. Apply the additive website migration through the existing Vercel production build. New columns/tables use `IF NOT EXISTS`. The Assurance migration runs after its dependency tables. Existing reports, memberships, auth, baselines and Java v1 native archive APIs remain usable.
4. Publish the existing Next.js website through its existing Vercel project. Do not introduce another hosting architecture or another Ledger.
5. Verify public pages, unauthenticated API rejection and the synthetic/staging account workflow. A production health probe must not start QA, send a notification or reveal a project.

Defaults preserve advisory operation. `automaticTriage`, `refreshExpiredAssessments`, `requireHeldOut`, `requireArchiveAcknowledgment` and `requireRetainedEvidence` are opt-in. Draft filtering applies only to explicitly saved drafts; existing requirements remain approved. Existing branch/label/PR/build exclusions remain persistent; new temporary exceptions add scope, reason, approver history and expiry.

Compatibility fixes: inactive directory identities cannot change/clear a stable externalId; membership removal deactivates the corresponding scoped directory grant and invitations; retry admission reserves another inference cap; hosted connections reject internal/reserved DNS. Enrolled private runners retain their explicitly authorized network scope. These changes intentionally stop demonstrated unsafe behavior.

## Rollback

Stop accepting new automatic/hosted work if an incident affects execution. Preserve failed/interrupted attempts and costs. Roll back the website to the recorded prior Vercel deployment and the engine pin as a pair. Leave additive schema/data in place; do not drop new tables or rewrite Ledger history. Disable the new opt-in flags before running an older gate implementation: an old deployment does not understand their enforcement. Do not roll back an offboarding/security fix without an equivalent temporary control. Review queued jobs before resumption; do not reset attempts or blindly retry paid work.

The authentication secret derives encryption keys for credentials, Ledger payloads, evidence and baselines. Keep it in the existing secret store and a separately protected recovery arrangement. Changing it is not an ordinary rotation procedure: ciphertext must be re-encrypted in a separately reviewed migration. Never restore encrypted data while discarding the corresponding key.

## Operation targets versus measurements

Proposed limited-pilot targets: restore service within one business day after an operator responds; recover to the latest verified daily database backup (RPO target 24 hours). Daily scheduling and an unstaffed project do not justify a 24/7 SLA. Targets are **not achieved production commitments**: backup cadence, monitoring response and ownership must first be configured and measured. The isolated small-fixture restore is evidence of restore mechanics only, not enterprise scale or production recovery latency.

Application ceilings are centralized in `operations.ts`: eight hosted assessments per calendar month, two globally active, fifteen-minute VMs, two vCPUs, twenty queued/running jobs per project and one thousand retained job records. Per-project active hosted work is also bounded by configured parallelism. These are checked code limits; actual provider account credits/quotas were not queried or increased. Model caps reserve attempted work, including explicit retries. Provider invoices, devices, storage, egress and VM bootstrap overhead can remain unknown and are reported separately.

Normal automatic execution is not retried on uncertain paid work. Duplicate deliveries reuse durable event/job identities. If the optional stale-refresh setting is enabled, a new signed event may request fresh QA after one hour; quotas still apply. Replayed delivery IDs never authorize new work. Reconciliation includes policy, active exception set, PR labels/draft and plan inputs so expired/removed exclusions do not permanently suppress new eligible events.

## Monitoring and incident handling

The authenticated daily maintenance path expires interrupted work, purges retained data, reconciles events, polls devices and processes archive delivery. Weekly work has a separate heartbeat. **Pilot & Ledger** shows job/archive states and last observed maintenance success. `/api/internal/operations` requires the existing operator bearer secret and exposes only task health, not customer payloads. Configure an authorized monitor for failed/interrupted state, maintenance success older than 26 hours and weekly success older than eight days. A saved cron secret is not proof that cron has run. No external pager or staffed incident response was provisioned.

On an incident: disable affected integration/automation; keep the original outcomes; record affected project, source/build, jobs and receipt head; inspect authorized logs with secrets redacted; reconcile uncertain provider work before retrying; restore in isolation if needed; then verify freshness, scope and Ledger integrity before re-enabling. No security-contact mailbox, response-time commitment, certification or on-call staffing is invented. The repository maintainer must assign an actual contact and operating owner before company rollout.

## Offboarding and artifact access

Every new project API/evidence/history/baseline request checks current explicit membership, domain and required-SSO policy server-side. There are no public presigned product-evidence URLs in this flow. Effective revocation target is the next request after the membership/directory transaction commits; already-running responses may finish. Downloaded/exported copies cannot be recalled. A company-owned integration principal is project-scoped; offboarding the owner suspends provider credential use and Java delivery until authorized identity/ownership recovery. Do not leave optional SSO as the only employee lifecycle control.

SCIM Users is intentionally narrower than full enterprise directory management. Configure stable externalIds and matching verified domain; do not map a different person onto an old inactive account. Groups and cross-project directory-admin assignment are unsupported. Emergency owner recovery requires an authorized company/deployment administrator, identity evidence and an audit trail; there is no unauthenticated recovery shortcut.

## Ledger and retention

The existing hosted Ledger remains authoritative for assessment versions and decisions. Java holds optional assessment archives, not a replacement copy of every hosted policy/decision event. Only an operator-approved exact HTTPS origin and a scoped `psl_` token can be connected. Never place a Java administrator token in the website. Archive states are pending/sending/confirmed/failed/conflict/expired; three attempts are bounded, interrupted final attempts become failed, and claim identities prevent stale responses from overwriting newer connection work. Reconciliation can revoke a confirmation that no longer matches the service. Pending archive work is visible but non-gating unless the owner requires acknowledgment.

A required acknowledgment binds the report digest and configured remote project/origin; switching destinations invalidates old confirmation. A required evidence gate checks retained exact-report-version ciphertext, size and digest. Missing/expired/corrupt evidence blocks that gate. These stricter settings are off for existing customers.

`GET /api/projects/PROJECT/ledger/history?recordId=RECORD` returns bounded pages of record events and preceding project definition/policy history. Follow `before=nextBefore` until null. Retained payloads and authenticated evidence references are included; large/expired payloads are explicitly marked. Evidence bytes require their separate authenticated download URLs. Save receipt heads outside the same database to detect wholesale history replacement. A database administrator can disable triggers/replace history; no absolute immutability or independent notarization is claimed.

Report/evidence/payload retention uses existing configured windows. Digest receipts remain until project deletion. Deleting a project cascades its online history and ciphertext; previously delivered Java archives, downloaded copies and provider backups have separate retention. A database backup can retain deleted data until its expiry. Restoring a backup requires reapplying the data controller's post-backup deletion log before granting access. The product does not claim automated provider-backup erasure or a deletion journal for company-operated external archives.

## Data flows

| Destination | Data and control |
| --- | --- |
| Vercel/Neon | Account/project configuration, encrypted provider credentials/evidence/baselines/Ledger payloads, reports and receipts. Storage/service operators remain trust boundaries. |
| Hosted VM | Exact read-only source, scoped job configuration, preview and selected model capability. Authored unit VM is separate/offline and gets no model/portal/callback credential. |
| GitHub | Read-only source/metadata/actions verification; optional authorized comments/labels/statuses in existing integrations. No product source-write endpoint. |
| OpenRouter/model provider | Selected source/context, requirements and configured observations; images only when explicitly enabled. Requests ask for no collection/fallbacks; this is not a contractual data-residency guarantee. |
| Local model | Context sent to the explicitly enrolled company model endpoint; private runners/network operation remain company-managed. Hosted OpenRouter does not require a customer runner. |
| Preview/API | Approved browser actions, synthetic cookies and explicitly authorized mutations in a disposable environment. Screenshots can contain product/user data; automatic redaction is incomplete. |
| AWS Device Farm | Company app/test uploads and real device execution after explicit configuration/consent. Device results are separate from source-byte attestation. |
| Java Ledger | Exact assessment snapshots after explicit transfer consent, approved origin and scoped token. Its service/database/backup policy is separate. |
| Slack/email | Optional configured summaries only; domain-restricted projects keep the existing delivery prohibition. Dashboard-only report delivery does not mean models/cloud providers receive no data. |

## Reproduce the isolated restore

Use the supplied fixture harness only with a disposable local PostgreSQL database named `ps_fixture_*`, `PS_ALLOW_FIXTURE_RECOVERY=1` and a fixture `DATABASE_URL`. It refuses remote/production names. Run `node --import tsx scripts/enterprise-restore-fixture.ts seed`, perform a local `pg_dump -Fc`, restore into a **different empty fixture database** with `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`, then run the harness with `verify` against that restored database. `PS_RESTORE_EXPECTED` holds fixture identifiers/counts/hash heads only. Keep the synthetic key fixed across seed/verify; never substitute production credentials. Remove only the containers/volumes created for the rehearsal.

Production backup/restore, key escrow, regional placement and retention require provider/operator access and are not validated by this fixture.

Enforced portal authorization now requires a completed server-enrolled job and
passing evidence for its frozen goal/replay/unit/critical-requirement denominator.
Standalone imported reports remain readable and their original check scores are
preserved, but cannot alone authorize a release. Report details explicitly show
missing execution scope. This closes an omission bypass rather than trusting a
worker-supplied percentage.

The two `scripts/enterprise-*-fixture.ts` development harnesses depend on test
helpers and are excluded from the Vercel source package alongside `/test` and
local artifacts. They remain in Git and in CI/local type checks. Production
migration/build scripts and all application type checks remain included.

## Launch milestone: tenant capacity (2026-10-30)

The connected Vercel team reports **Hobby**, Node **24.x**, region **iad1**.
The read-only team API returned no account-specific quota/remaining-usage values.
The eight-start allowance and two-active limit above are application pilot controls,
not measured infrastructure capacity. No paid resources or provider quota changes
were made. Existing projects retain legacy mode and their defaults.

An operator may explicitly select `fair` mode over the same `qa_jobs` table.
`capacity.ts` serializes admission/claim decisions in PostgreSQL; `capacity-schema.ts`
adds durable reservations and stage tracking. A company quota groups explicitly
enrolled project owners; matching email domains alone do not grant enrollment or
membership. Multiple projects/owners consume the same company budget. One oldest
job per company competes by last dispatch; simultaneous drainers cannot overclaim.
Tenant/global queue bounds return 429 and Retry-After; resource-budget exhaustion
leaves an explicit waiting job until its queue deadline. No silent paid retry occurs.

Each job reserves one 15-minute, two-vCPU/four-GB stage, or two stages for authored
units plus browser QA. It reserves 1,800 CPU-seconds, 3,600 GB-seconds and $0.10
**projected compute expense per stage**, without refunds on failures. Stage-count
checks prevent additional provider creates. Uncertain create/stop outcomes retain
the safety slot; known VMs extend the hold from their observed creation. The
provider's hard VM timeout bounds known execution, not an unlimited retry.
Provider creation ambiguity still requires operator reconciliation; it is not proof
of successful termination. Current calendar-month resource counters survive
project deletion; initial enrollment transfers prior usage and switching from
legacy mode conservatively carries existing legacy starts forward. Opaque job,
project and tenant accounting identifiers are purged after 90 days once safety
holds end; project content and credentials are not copied into this accounting.

These are conservative resource reservations, **not a cap on the entire invoice**.
Model requests keep the existing per-project attempted-inference reservation and
customer-scoped key. Storage, network transfer, other applications in the Vercel
team and provider accounting periods require separate reconciliation. A customer's
model key is never shared with another customer. Deleting historical legacy jobs
before this change can leave unmeasured prior usage. An operator must establish
available provider headroom before enrolling a pool.

### Operator activation and rollback

Use `tools/launch/capacity.mjs get` with the existing operator secret supplied as
`PATCHSENTRY_OPERATOR_SECRET` in the process environment and an exact HTTPS
`PATCHSENTRY_PORTAL_URL`. Never put a secret in arguments, committed files or chat.
Save the returned JSON policy locally; retain its version and original mode.
`pool FILE` PUTs its `policy` object with `expectedVersion` and explicit
`approveCapacityAndCost:true`; `tenant FILE OWNER_ID` takes
`{tenantKey: COMPANY_UUID, limits: {...}, expectedVersion: N}`. Use the same company
UUID for all its owners and the current company version for subsequent owners.
Enrollment is operator-only; project users cannot raise the pool or reset usage.

1. Inspect provider remaining usage and approve a compute/egress/storage budget.
2. Enroll company owners and quotas while still in legacy mode. Start no test work.
3. Drain/cancel all queued/running hosted work before switching mode. Confirm
   uncertain provider VMs in the provider console. Preserve reservations.
4. Establish and monitor a drain pulse, then opt into `fair` with the current version.
5. Verify `GET /api/internal/capacity`, project Pilot & Ledger capacity and
   `/api/internal/operations` heartbeat. Configuration is not load validation.

The optional `hosted-queue-pulse.yml` workflow stays off unless repository variable
`PATCHSENTRY_QUEUE_PULSE_ENABLED=true`. Set the exact trusted portal origin in
`PATCHSENTRY_PORTAL_URL` and existing operator bearer in Actions secret
`PATCHSENTRY_CRON_SECRET`. Its five-minute schedule requests bounded recovery/drain;
GitHub scheduled delivery is best-effort and has no queue-latency SLA. Job condition
skips unconfigured runs; it does not re-enable the disabled engine QA controller.
Account billing/minute allowance must be checked before enabling it. The existing
Vercel daily/weekly schedules are unchanged. Event intake and completion also drain,
but those alone cannot guarantee wake-up when a minute rate limit has elapsed.

Rollback capacity: disable the pulse, stop new intake, reconcile/cancel queued and
running work, restore the saved pool policy using its **current** expectedVersion.
Mode switching refuses active/queued work. Never delete reservations to recover
quota. Roll back application source/deployment separately; leave additive tables.

### Measured operating envelope and costs

See `docs/evidence/launch/load.json` and `recovery.json` for raw synthetic results.
Ten actual critical-release suites (44 tests each) ran through real PostgreSQL16
with the same ten-connection application pool and bounded Linux/arm64 Node24
containers. Three company tenants, ten accepted jobs, one flood rejection:
10/10 completions, max two concurrent, 5.85 jobs/min, queue p50 32.694s,
p95/max 89.189s, total 102.608s. Drain calls were continuous in this local harness;
creation-rate allowance was ten/minute **in the fixture only**, not production.
This initial run is retained as `load.json`. A final-code repeat (`load-final.json`)
completed10/10 (46 checks/job), in121.090s:4.95 jobs/min, queue p50 40.856s,
p95/max105.645s, peak sampled memory2.56GiB/4GiB and CPU217.99%.
Total final worker wall time178.517s; compute normalization below becomes$0.01690.
Both runs used the same resource caps; they are small samples, not an SLA.
Total worker wall time was 149.949s. Samples peaked at 2.664GiB per 4GiB worker;
short sampling windows reported up to 212.3% CPU with a two-CPU cgroup quota.
Network was disabled. Sampling overhead and shared development hardware affect
these values. Orchestration ran on development Node26; worker tests ran on Node24.
These are backend-test scheduler results, not Vercel microVM/browser throughput.

[Official Sandbox pricing](https://vercel.com/docs/sandbox/pricing) lists Hobby
limits of 5 active-vCPU hours, 420 GB-hours, 5,000 creations and 20GB transfer per
month, ten concurrent sandboxes and 45-minute maximum life. These are published
plan limits, not this team's remaining allowance. iad1 reference rates are
$0.128/active-vCPU-hour and $0.0212/GB-hour. Memory uses provisioned allocation;
active CPU differs from wall time. No cloud sandbox was started for this rehearsal.

At those reference rates, two vCPUs and four GB for all 149.949 worker-wall seconds
would normalize to **$0.01420 compute**, excluding cloud bootstrap, idle provisioned
memory, creation, network, storage, models and platform operations. This is a
resource-equivalent projection, not observed spend or an invoice. Actual hosted
cost remains unknown. The $0.10/stage reservation covers a 15-minute compute
projection (~$0.0852) plus a small compute margin; it cannot cap arbitrary egress.

Recommendation: keep two global jobs, one per company and two starts/minute for
an operator-enrolled pilot; keep the existing eight/month global default until
real hosted usage/headroom is measured. Fair-mode defaults reserve at most four
CPU-hours/month, leaving nominal CPU headroom inside the published five-hour plan;
other team workloads can consume it. Four single-stage starts/company, queue20
per company/40 global and 60-minute expiry are configurable **starting controls**,
not enterprise entitlements. Broad enterprise volume requires an operator-approved
hosting/budget decision and a real hosted load run. No such commitment is made here.

### Recovery targets and measured limits

The isolated rehearsal used PostgreSQL16 (two CPU/one GB), a 116,363-byte synthetic
backup, the existing encrypted evidence/baseline/provider-key fixtures and fixed
test-only key. Backup took 110ms; restore270ms + verify763ms. Corrupt artifact ciphertext was detected; a separate regression rejects valid
ciphertext whose plaintext does not match its receipt;
restoring another copy took258ms + verify533ms. Prior-release `e067162` code could
read/decrypt the additive schema in627ms. Total backup-through-rollback rehearsal
was3,328ms. A rolled-back migration transaction left no partial table. Data lost
after the snapshot was not claimed recovered; fixture RPO is snapshot time.

An actual offline QA container was killed. Its expired lease became blocked/not
tested in5ms once recovery ran; its uncertain slot stayed reserved, another tenant
could claim, and explicit local stop confirmation released the hold. A queued job
survived a simulated ten-minute deployment pause. Fixture lease deadlines were
advanced using SQL; no real 32-minute wait or Vercel traffic interruption occurred.

Rehearsal acceptance targets: complete small-fixture restore+verification under60s;
recovery-controller execution under5s; zero false successful assessments after
interruption; no cross-tenant overclaim. These passed locally. Production targets
remain operator-response within one business day and RPO24h, contingent on actual
backup cadence/escrow/monitoring. Neon snapshots, regional failure, production-size
restore, post-backup deletion replay and Vercel atomic routing rollback remain
external validation, not satisfied by this isolated test.

### Reproduce the launch workload

Prepare trusted dependencies outside execution:
`docker build -t patchsentry-offline-tests:launch tools/test-image` in the engine;
in the website use `docker build -t patchsentry-release-qa:launch tools/qa-runtime`
with a sanitized context containing the root package files plus the runtime recipe
and `run.cjs` (the Dockerfile's COPY paths are relative to that context). No customer
source or credentials belong in a dependency image. Run engine tests with both
`QA_PUBLIC_TEST_IMAGE` and `QA_WORKSPACE_TEST_IMAGE` set to the reviewed image and
both browser flags1. Product test containers use no network/pull/install.

Use `tools/launch/snapshot.py candidate` **before** executing a newly registered
challenge, then `tools/launch/evaluate.py`; the latter prepares/executes only fixed
suite commands in read-only disposable copies. Preserve its original reports before
fixes. After adding regressions, create the `regression` snapshot and set
`PS_EVALUATION_PHASE=post-regression`; this selects the two discovered misses and a
healthy control and cannot turn the original result into held-out success.

`test/launch/load.ts` requires explicit `PS_ALLOW_FIXTURE_RECOVERY=1`, loopback
`DATABASE_URL` named exactly `ps_fixture_launch` or `ps_fixture_launch_final`, an
empty database, approved `PS_QA_SOURCE` snapshot path, and isolated Docker runtime.
It uses actual PostgreSQL ten-connection configuration, multiple company owners,
eight concurrent claim attempts and two bounded release-test workers. The raised
fixture-only quotas/rate are never applied to production. `queue-recovery.ts` uses
the first fixture database only and kills a fixed-name local test container;
`recovery.py` uses the fixed `ps-launch-postgres` container and separately named
synthetic restore databases. Do not substitute a remote or production database.

Snapshot fixtures/keys are intentionally synthetic. Export only explicit measured
summaries and their hashes to the existing Ledger with
`test/launch/archive-validation.ts`; it refuses production/remote databases and
labels entries `internal-launch-validation`, which never counts as a successful
assessment or independent qualification. Preserve the returned receipt head
outside the database. The optional Java archive's assessment-only behavior remains.

Final reservations additionally freeze the pool policy, company quota version and
quota values used at claim time. The capacity-reserved Ledger event archives that
allocation before provider execution; later quota edits cannot rewrite its context.
Legacy carryover is explicitly approximate and cannot reconstruct deleted legacy
usage or historical company quota versions. This additive audit change was checked
on PostgreSQL during the final queue-recovery/receipt exercise; load timing above
was measured before this extra JSON snapshot write.

Reviewer reproduction prerequisites: the measured host was macOS with Docker
Desktop and development Node26/Python3.9; execution images were Linux/arm64 Node24.
The harnesses deliberately use fixed `/private/tmp/ps-launch-*` fixture paths and
loopback ports55438/3111/3112. Use a disposable matching host or explicitly adapt
those fixture paths in an isolated reviewer environment. Linux/amd64 engine CI
success is separately linked; it does not make the Mac host scripts production
recovery automation. No production deployment credentials belong in the package.

Post-run final fixture PostgreSQL statistics:10,222,615 database bytes,280 committed
and one rolled-back transaction,27 block reads/72,178 hits, zero temp bytes and zero
deadlocks. The post-run container sample was81.78MiB/1GiB with idle CPU; **not peak
DB memory/CPU**. `database-resources.json` retains exact counters. DB/evidence/
baseline/Ledger ciphertext, duplicate receipt payload retention and backup copies
are storage cost drivers. This tiny synthetic dataset does not establish Neon
production storage limits or price. Query/connection saturation and production
backup growth remain part of the operator's hosted-scale validation.
