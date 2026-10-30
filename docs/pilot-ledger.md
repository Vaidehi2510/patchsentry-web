# Pilot evaluation, release rollout and Patchsentry Ledger

Open **Pilot & Ledger** in a product workspace. New rollout policies start in advisory mode. Existing test failures remain visible; advisory CI publication is explicitly non-gating and never authorizes deployment.

## Roles of the three components

- **QA-testbot** inspects the read-only source and executes/replays configured checks, producing assessment reports.
- **patchsentry-web** manages identity, requirements, test configuration, pilots, cost evidence and release policy. It evaluates the exact current assessment before returning a release authorization.
- **Patchsentry Ledger** retains assessment versions and decision history. The website now includes a hosted ledger using its existing database. The separate Java Ledger can hold an additional project-scoped archive copy after deployment. Ledger does not execute tests or turn an archival receipt into proof of correctness.

## Controlled benchmark

The public TodoMVC pilot was rerun on 2026-10-30 against upstream commit `ff43b02e59dfa604386bb382034b2cd07c2bcd8a`. Its distribution stayed unchanged; mutations were separate QA artifacts. Across Chromium, Firefox and WebKit, desktop/mobile repeats exercised 78 targeted cases: 42 clean controls, 30 seeded-defect executions across five fault types, and six wrong-revision controls. All targeted outcomes matched; there were zero false greens and zero unexpected failures on the selected clean-control probes.

These are **scoped benchmark results**, not 78 passing full-product assessments. Pre-existing accessibility/asset findings were retained separately. AI diagnosis was not evaluated. Inference cost was zero because no model was called; infrastructure and human-review costs remain unknown. See `src/data/todomvc-benchmark.json` and rerun the engine's `src/pilot/todomvc.js` against the pinned distribution. Controlled results never qualify production gate promotion.

## Production pilot

1. A QA engineer registers a pinned repository revision and cases with exact automated check IDs, expected `defect`, `clean` or `identity-block` outcomes, and requirements.
2. A different QA engineer/admin/owner reviews the labels before execution. Labels cannot be edited after registration.
3. Run fresh assessments. Each linked report must come from a completed project QA job requested after review, on the registered revision. A case can be linked once. The observed result and report digest are frozen; later report changes or expiry invalidate its current eligibility.
4. Review measured defect detections, misses, incomplete coverage, false alarms on verified negative controls, execution completeness and distinct assessment costs. Unknown and estimated costs do not count as measured under strict cost policy.
5. Supply actual company SSO/offboarding/device/security-assessment documents as applicable. Record the issuer, SHA-256, private reference and unresolved risks. A different admin reviews the source document and issuer. This records a company review; the system cannot establish an external assessor's independence from a text field.
6. The owner can promote to enforcement after recent MFA only when the selected thresholds and evidence requirements are met. Default thresholds require at least twenty production cases, five distinct assessments, 95% observed recall/completeness, at most 5% false alarms, known costs and current reviewed security evidence. Thresholds are product policy, not statistical guarantees. Every decision rechecks eligibility; stale reports, unknown cost and expired evidence can block a previously promoted policy.

Metrics cover at most the latest 100 suites and display the ten latest. Missing reports count as missing observations. No whole-product defect recall, headcount reduction or monetary savings is inferred from a labeled sample.

## Exact build provenance

In the provenance panel, provide an assessment record ID, GitHub Actions run ID and artifact ID. Read-only GitHub access must include Actions read. Verification requires:

- A completed **hosted build/release** assessment with passing artifact-byte and artifact-stability checks.
- A successful workflow in the connected GitHub repository with the exact assessment source SHA.
- An unexpired GitHub artifact belonging to that run, with the same source SHA and SHA-256 as the bytes actually tested.

This uses the [GitHub artifact metadata API](https://docs.github.com/en/rest/actions/artifacts). It is not a reproducible rebuild, SLSA attestation verification or an independent hash of AWS's stored upload. Those claims remain unavailable. Native AWS upload declarations alone cannot authorize production release.

Signed CI build manifests can include `request.githubBuild: { "runId": 123, "artifactId": 456 }`. Hosted completion attempts provenance verification automatically. If scopes, identity or evidence do not match, authorization remains blocked; an admin/QA engineer can retry verification deliberately after fixing access. Serve/test the exact artifact bytes represented by GitHub's digest; an extracted file's digest is different from the archive digest.

The CI result endpoint now returns `assessmentPassed`, `rollout` and `canProceed`. `canProceed` is true only for an enforced, qualified policy with passing exact-assessment evidence. The publisher script exits non-gating in advisory mode and says explicitly that it has not authorized deployment. Direct runner release-gate responses also apply the rollout policy. Production decisions are recorded in Ledger.

## Hosted assessment ledger

Completed reports are archived automatically with the report transaction. Corrections create another immutable version; historical snapshots are not overwritten. Policies, review decisions, provenance and CI release decisions append receipts to a per-project SHA-256 chain. The UI can verify the receipt chain and export retained encrypted report snapshots. Save the head receipt separately to detect wholesale history replacement.

Database triggers reject normal entry updates/deletes. A database administrator can disable triggers or replace an entire history, so this is tamper-evident relative to retained receipts, not independent notarization or a blockchain. Verification is bounded to the first 10,000 receipt entries and reports explicitly if incomplete. Payload integrity is checked on export/delivery. Encrypted copies expire under report retention, leaving digest receipts; deleting the project erases its ledger and retained payloads.

The owner can backfill the next fifty retained completed reports per request. Reports already overwritten or removed before this feature cannot be reconstructed.

## Optional Java Ledger archive

No additional deployment is needed for the hosted ledger. To use the separate Java repository:

1. Deploy its updated container and Postgres/MongoDB/Redis using the repository's deployment instructions. Company hosting and datastore operation remain separate; no external service was provisioned automatically.
2. A Ledger operator creates the repository project and issues a **scoped `psl_` runner token**. Keep the global admin token out of the website.
3. The website deployment operator sets `LEDGER_ALLOWED_ORIGINS` to the exact trusted HTTPS origin(s), comma-separated. Browser users cannot register arbitrary outbound credential destinations.
4. In **Pilot & Ledger → Optional Java Ledger archive connection**, verify that origin/token and explicitly approve assessment transfer. The service must return a matching repository/project and the `assessment-archive-v1` capability.
5. Delivery is project-scoped, encrypted, outbox-backed and idempotent. Daily maintenance processes pending records; the owner can request delivery or retry failed/conflicting receipts. The website confirms the exact remote project, record and digest. Unconfirmed delivery is never shown as archived.

Native archive endpoints preserve both PRs and build/releases without inventing a PR number:

- `GET /api/runner/project`: scoped repository identity/capabilities.
- `PUT /api/runner/assessments/{recordId}/{payloadDigest}`: append exact uploaded bytes; identical retries return the same receipt.
- `GET /api/runner/assessments/{recordId}/{payloadDigest}`: scoped archive receipt.

The legacy Java PR-scoring API remains separate. Java receipts attest storage, not independent test execution or release approval. Java copies have their own company retention/access policies; disconnecting delivery or expiring website payloads does not erase an already delivered Java archive.

## Remaining external validation

A real company Entra/offboarding pilot, an AWS physical-device pilot and an independent assessor's review require authorized accounts, actual product artifacts and an assessor. These cannot be fabricated by software scaffolding. The website records those gaps and blocks selected enforcement requirements until reviewed evidence is supplied. The shared hosted capacity remains the documented limited pilot allowance, not an enterprise-scale managed fleet.
