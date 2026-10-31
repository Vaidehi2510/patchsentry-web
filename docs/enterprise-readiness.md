# Supported QA operations and enterprise acceptance

Assessment date: 2026-10-30. Baselines: website `4c6cae5`, engine `4b5fac3`, Java Ledger `6a15e90`. This release extends those implementations; it does not replace authentication, hosting, storage, navigation or Ledger.

## Current launch milestone decision

Latest continuation starts from deployed website code `37e9fba` / documentation
`e067162`, engine `d0ae18a` and Java `6a15e90`. Earlier baseline references below
are historical. Current verified results are in `enterprise-verification.md` and
`docs/evidence/launch`; operation/activation/rollback instructions remain in
`enterprise-operations.md`. No new readiness dashboard was created.

| Decision | Result and evidence |
| --- | --- |
| Platform enterprise readiness | **Limited advisory pilot; broad enterprise launch remains blocked.** Configurable company quotas, fair PostgreSQL scheduling, bounded resource/stage reservations, backpressure, opt-in company controls, offline Docker validation and isolated recovery are implemented/tested. Real hosted scale/cost, company identity/device interoperability, production recovery and independent review are not established. |
| Individual project enforced gates | **Not automatically qualified.** Existing defaults/project settings remain. Owner opts into controls after recent MFA; real product expectations, provenance, retained fresh evidence, approved models/budgets, held-out results and required reviewed integration evidence must separately qualify. No production project was activated or promoted by this milestone. |
| QA responsibilities demonstrated | **Actual Patchsentry backend release-suite execution and deterministic internal defect checking.** Final load completed10/10 jobs (46 checks each) across three company tenants; two original Ledger regression misses were closed. The initial four-defect challenge still records2/4 detected. UI/mobile/accessibility control checks and recovery mechanics are demonstrated locally. AI diagnosis, entire-product recall and staffing replacement remain unmeasured. |

Final load:4.95 jobs/minute, p50 queue40.856s, p95/max105.645s, two active,
one company flood rejection, peak sampled worker memory2.56GiB/4GiB. Results
cover constrained Node24 Linux containers and real PostgreSQL, not cloud browser
throughput. Prior10-job run and raw samples are retained separately. Keep the
two-global/one-company pilot recommendation and existing eight/month default;
operator must verify remaining provider headroom and opt in before changes.

### Remaining external launch criteria and exact next actions

| Criterion | Required person/access/evidence | Next concrete action and completion condition |
| --- | --- | --- |
| Hosted operating capacity | Deployment operator with Vercel Sandbox usage/billing and approved budget; monitored drain service | Read remaining team usage, enroll company limits and pulse, run bounded actual microVM/browser workload. Retain queue/completion/resource and invoice evidence before promising volume. Local benchmark does not complete it. |
| Company SSO/lifecycle | Company Entra Application Administrator, DNS owner, test identities and actual provisioning logs | Follow the prepared tenant-pinned OIDC/SCIM matrix. Retain enforcement, linking, deactivation/session denial, recycled identity and recovery outcomes. No real provider access was locally available; production customer credentials were not exported. |
| Physical devices/provenance | Company AWS administrator + build owner; scoped temporary IAM, accepted disposable app/test uploads, explicit device-minute budget | Validate supplied policy template, run healthy/known-defect/cancellation cases and reconcile results/billing. Bind actual source/build/app/test bytes before product gate qualification; AWS upload declaration alone is insufficient. |
| Production operations | Database/deployment recovery owner, isolated production-representative copy, test key escrow, provider rollback permission and deletion log | Perform provider-backed restore, post-backup deletion replay and actual isolated deployment/traffic rollback; measure agreed production-size RTO/RPO. The3.33s small-fixture rehearsal is mechanics evidence only. |
| AI QA effectiveness | Project/evaluation owner, securely configured model and approved bounded inference budget | Connect/inference-check in protected setup, freeze prepared inputs/model/call/cost cap and run diagnosis separately; retain independently adjudicated roots/fixes, costs and unknowns. Preparation makes zero model calls. |
| QA workload replacement | Product evaluation owner and authentic manual/tool-assisted comparison/time logs | Extend authorized own-release workload to real incidents/critical journeys with independent held-out labels; measure misses, false alarms, setup/maintenance/triage/approvals and total human work. Current tool-assisted baseline supplies no manual time saving. |
| Independent security | Named external assessor accepting authorized staging scope | Give the reproducible reviewer archive; obtain dated findings and external retest/closure evidence. No assessor or authentic external findings were supplied. Internal findings cannot satisfy this criterion. |
| Optional Java archive | Company Ledger operator, deployed HTTPS service, approved origin and scoped project token | Deploy existing Java service only under approved hosting; connect through current UI, backfill/reconcile and retain destination-bound acknowledgments. Hosted Ledger is already usable; Java is only a blocker for projects requiring its acknowledgment. |

No paid capacity was provisioned, customer project defaults changed, external
notification sent or disabled engine controller re-enabled. No absolute QA
replacement, independent assessment or enterprise SLA is asserted.

## Readiness decision

**Controlled pilot / advisory use. Not yet qualified for a general enterprise production QA replacement.** Supported routine work can run unattended after explicit configuration: change intake, frozen regression execution, data assertions, deterministic candidate-defect reporting, protected evidence, weekly reporting and evidence-backed release evaluation. Owners/engineers approve new business expectations, exceptional risk and ambiguous findings; a resident QA operator is not required to click through each normal run.

Enforcement remains project-specific and opt-in. Synthetic benchmarks do not qualify a product. A passing CI suite proves the tested software behavior, not customer defect recall, organizational readiness, staffing savings or an SLA.

## Capability matrix

A = automated within the configured scope; R = occasional authorized review; E = external integration/configuration required; U = unsupported beyond the listed scope.

| QA responsibility | Mode and supported scope | Review or limit |
| --- | --- | --- |
| Requirements, business rules, roles, critical journeys | A/R: versioned expectations, mappings and frozen plans; inferred drafts are excluded | Owner/engineer confirms business intent. No automatic redefinition after a failure. |
| Change detection and selection | A/E: signed PR/CI/deployment/release intake, repository re-verification, deduplication, daily reconciliation | Full configured regression is retained. No claim of optimal code-impact selection or exhaustive coverage. |
| Unit tests | A/E: bounded authored Node tests in credential-free offline hosted VM; enrolled runner suites | Hosted dependencies/build scripts and arbitrary framework installation remain unsupported. |
| UI and API/data | A: approved browser journeys and same-origin JSON/status assertions with synthetic session cookies | Assertions must specify amount, ownership, permissions and downstream state. No production DB writes or inferred business oracle. |
| Integration testing | A/E: explicit UI/API observable integration outcomes | Internal services, external side effects and cleanup require a disposable environment and enrolled interfaces; not arbitrary live-service orchestration. |
| Responsive/browser regression | A: configured Chromium/Firefox/WebKit/viewports, replay, persistent visual baselines | New/changed visual expectations require explicit review. Pixel differences do not establish UX quality. |
| Accessibility/keyboard | A/R: axe rules and explicit keyboard/focus journeys | Assistive-technology and subjective accessibility review remain specialist work. |
| Native/physical devices | A/E: enrolled native adapters and bounded company AWS Device Farm orchestration | Real signed apps, Appium packages, scoped AWS account and a real device pilot are required. No managed device fleet is supplied. |
| Defect reporting and classification | A/R: opt-in deterministic failed-check reports, frozen expected/actual context and evidence links | Root cause and suggested fixes remain unverified. Source files are never changed. Ambiguous defects require clarification. |
| Regression maintenance/flakiness | A/R: contradictory comparable outcomes create investigations; repeat/replay checks for resolution | No automatic assertion changes or silent quarantine. A flaky failure stays failed/missing coverage. |
| Performance | A/E for explicitly enrolled performance assertions/suites | U for managed load generation, distributed load testing or performance-engineer replacement. |
| Resilience | A for tested worker expiry, failed preparation, interrupted delivery, bounded recovery | U for arbitrary application chaos experiments or destructive production fault injection. |
| Security-related QA | A/E for configured permission oracles, execution controls, tenant isolation and dependency checks | U for independent penetration testing, threat-model completeness, certification or specialist replacement. |
| Release recommendation | A/R: exact assessment, plan/configuration, freshness, unresolved risks, provenance and qualification checks | Business risk acceptance remains an authorized decision. Passing an assessment in advisory mode does not authorize deployment. |
| Reporting and governance | A/E: dashboard, scoped exports, weekly reports, optional Slack/email, Entra/SCIM | Domain-restricted projects retain outbound report restrictions. SSO is Entra-specific, SCIM Users-specific, and projects are the tenant boundary. |
| Organization-wide administration | R/U: explicit project owner/admin/QA/viewer roles and project-domain controls | No organization-wide group policy engine, SCIM Groups, SAML, Google/Okta SSO or regional tenancy contract. |
| Human-work measurement | A/R: paired workload time logs for setup, maintenance, triage, approvals and execution | Company-supplied measurements and estimates are distinguished. No observed staffing replacement or savings yet. |

## Acceptance and evidence matrix

Implementation, automated verification, real-provider validation and independence are separate. Operational owners below are required roles, not a claim that someone is staffed or assigned.

| Acceptance requirement | Implementation / automated evidence | Real integration / remaining limitation | Required operational owner |
| --- | --- | --- | --- |
| Preserve legacy projects and history | Additive `assurance-schema.ts`; repeat migration, archived payload, project cascade and PostgreSQL restore tests | No production restore was attempted. Previously overwritten history cannot be reconstructed. | Deployment/database administrator, not assigned by this release |
| Approve facts before release expectations | `quality.ts`, `quality-hub.tsx`; inferred drafts, version history and optimistic requirement tests | Customer intent needs explicit approval. | Product owner/authorized engineer |
| Prevent omitted checks from passing | `execution-evidence.ts`, `automation.ts`, `pilot-assurance.ts`; required goal/replay, method, required flag and freshness regressions | A company-controlled runner remains a trusted evidence issuer; receipt storage is not proof it executed honestly. | Product integration owner |
| Prove tenant and role boundaries | Existing account/enterprise/evidence suites plus `enterprise-hardening.test.ts`: outsider IDs, downloads, membership removal, history and machine-principal suspension | Projects, not a new organizational hierarchy, isolate data. In-flight responses and downloaded copies cannot be revoked. | Company identity/project administrator |
| Entra protocol and SCIM offboarding | Signed OIDC fixture tests; issuer/audience/tenant/nonce/state/PKCE tests; recycled external-ID rejection; manual removal cannot be undone by login sync | No real tenant credentials supplied; Entra interoperability/real employee offboarding remain unvalidated. | Company Entra administrator |
| Isolate untrusted execution/data | `hosted-unit.ts`, hosted isolation tests; engine `network.test.js` and real browsers; summary redaction | No independent VM escape assessment. Screenshots/PII are not reliably auto-redacted. | Deployment/security owner |
| Reliable unattended operation | Durable events/leases, retry reservations, `operations.ts`, fair maintenance/archive scans and health records | Shared pilot ceilings remain eight hosted assessments/month and two active globally; no enterprise capacity commitment. | Deployment operator |
| Preserve complete decision context | Existing Ledger plus definition/test/usage/evidence/bug/policy/context events; scoped paginated release-history retrieval | Old reports may lack frozen job context; retention can remove encrypted payloads while leaving receipts. | Project owner/data controller |
| Durable Java archive and acknowledgment | Destination-bound encrypted scoped credentials, claims, bounded retries, reconciliation, opt-in acknowledgment gate | Java is not deployed. Hosted Ledger works independently. Real local service test is separate from fixture HTTP tests. | Company Ledger operator |
| Build provenance | Existing GitHub run/artifact/byte verification; repeat-verification history fix | GitHub/provider evidence is not a reproducible build, SLSA/Sigstore validation or AWS-upload byte attestation. | Company CI/build owner |
| Measure effectiveness | Existing TodoMVC data plus controlled checkout harness: amount, permission, async, identity and infrastructure cases; held-out labels and unique defect IDs | Own-product release QA measured in the launch follow-up; no AI diagnosis or customer workload qualification. Controlled labels do not establish whole-product recall. | Product evaluation owner |
| Measure human work | `pilot-work.ts`, `pilot-evaluation.tsx`; estimated vs measured paired-sample regression | No authentic manual-workflow baseline or observed reduction. Time logs are self-reported. | Company evaluation owner |
| Recover assessments and required evidence | `enterprise-restore-fixture.ts`: PostgreSQL dump/restore, counts, Ledger hashes, encrypted evidence, baseline and credential decryption | Synthetic local Postgres only. Production backup cadence, key escrow and RTO/RPO remain unverified. | Database/deployment administrator |
| Independent security assurance | Updated `security-review.md` handoff and reviewed-document workflow | **Not performed.** An implementation author or another coding agent is not an independent assessor. | Authorized independent reviewer, not supplied |

## Defensible offering wording

“Patchsentry automates configured routine QA workflows for disposable product previews and enrolled test environments. It preserves approved expectations, checks exact changes, records actionable candidate defects and evidence, and applies project-specific release policy. Coverage, integration status, limits and untested risks remain visible. Production enforcement requires product-specific qualification.”

Do not advertise “replaces every QA function,” “enterprise certified,” “independently assessed,” “no data leaves the dashboard,” guaranteed defect recall or measured staffing savings.

## External completion dependencies

1. A company administrator connects a real Entra tenant, verifies linking, forced-SSO alternative paths, deactivation, reactivation, recycled identity rejection and machine-owner recovery. Retain authentic reviewed evidence.
2. A company AWS owner supplies an authorized disposable app/test package and scoped account. Run physical devices only with approved budget; verify cancellation, uncertain scheduling, artifact identity and actual provider billing.
3. An authorized independent assessor reviews the documented scope, reports authentic findings and verifies remediation. Record issuer, digest, reference, reviewer and validity period.
4. A deployment operator verifies actual Vercel/Neon/provider quotas, funds enterprise capacity deliberately, configures monitoring/backup ownership and executes an authorized production-like restore. No allowance increase is automatic.
5. A product owner freezes real supported workloads and held-out defects, executes them, records provider/model/runtime costs and measures the same manual/tool-assisted workload including setup/maintenance/triage/approvals. Only then evaluate routine-work replacement for that scope.

An external dependency blocks only its corresponding validation; it does not substitute for the engineering and controlled verification delivered here.
