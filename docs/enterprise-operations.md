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
