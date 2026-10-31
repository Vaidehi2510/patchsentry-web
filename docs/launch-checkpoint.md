# Enterprise launch milestone checkpoint — 2026-10-30

Baseline website `e067162` (production code `37e9fba`), engine `d0ae18a`, Java `6a15e90`. Isolated branches `enterprise-launch-20261030`; website work `/private/tmp/patchsentry-web`, engine work `/private/tmp/patchsentry-engine-launch`. Original engine `.DS_Store` is unrelated and preserved. No former-employer source is in scope.

User authorized Patchsentry's own release QA workload. Human manual-time baseline is unavailable; measure existing tool-assisted workload and do not fabricate human savings.

Verified: baseline website 165 passed. Engine now 338 passed / zero skipped with real browser flags and both previously omitted offline Docker tests using inspected immutable local image `qa-public-nodego@sha256:8858b8b4bdf04d7d24b4ce0b9c642642576386d2c28e71143791bc5e7501ed2b` (Node22.23.3, Go1.26.8, Vitest5.0.3). Need reproducible image enrollment/CI preparation.

Read-only Vercel metadata: connected team Hobby; project Node24, iad1. Team API exposes no account-specific limits. Current official Sandbox pricing lists plan concurrency/CPU/memory/creation/network limits; these are distinct from hardcoded application counters. No paid resources started or quotas raised. No AWS/Azure ambient credentials, CLI or local profile/cache found. Secure stored company integration status still needs authorized verification without exporting secrets.

Work: opt-in fair pool and owner-scoped tenant quotas over existing qa_jobs, durable resource reservations and bounded drain/recovery; no default allowance increase. Coherent owner-approved enterprise policy with active versus externally validated status. Local PostgreSQL/constrained-container load/recovery and actual release-workload evaluation. Reviewer handoff, updated existing matrices and Ledger evidence. Preserve advisory defaults and existing optional Java archive.

Completed internal engineering/evidence: configurable fair tenant pool, company
enrollment, queue/backpressure/rate/concurrency/resource reservations, provider
stage bounds and uncertainty tracking; legacy usage carryover and frozen quota
Ledger context; 90-day opaque accounting retention. Opt-in owner/MFA enterprise
profile in existing Release policy, version/drift/identity/repository prerequisites,
approved model consistency, current gate and platform status separated.

Final website177/177 on host and Node24 offline worker; engine338/338 zero skipped;
typecheck/build and dependency audits passed. Engine published5c1114b; its CI passed.
Both former Docker skips run from a reproducible pinned dependency image. UI
Chromium/axe/mobile checks passed. Prior website deployment remains rollback target.

Initial own-product defect challenge:2/4 detected,2 missed; both healthy controls
passed. New regressions catch both misses; follow-up healthy176/176 passed. Final
full177 tests include one additional authorization test. No held-out/customer
recall or human savings claim. Six AI diagnosis inputs prepared; no inference.

Final scheduler load10/10 jobs,46 checks/job,3 companies, max2 active, one flood
rejection,4.95jobs/min, queue p50 40.856s / p95 105.645s. Local resource projection
$0.01690 compute equivalent, not a measured invoice; cloud/egress/storage/model
costs remain unknown. Original load and source manifests retained separately.
Backup-through-prior-code-recovery3.328s on tiny synthetic Postgres; real worker
kill/controller6ms once invoked, uncertain slot retained, another tenant progresses.
Provider recovery/traffic routing is still unvalidated. Verified existing-Ledger
internal validation receipt binds18 artifact hashes in a synthetic project.

External criteria/owners/next actions are listed in the current readiness matrix:
actual hosted capacity/billing and pulse; company Entra lifecycle; AWS devices and
build provenance; production-size backup/key/deletion/traffic rollback; bounded AI
and authentic human comparison; named independent assessor; optional Java deployment.
No production projects/configurations were opted in and no paid resources provisioned.
