# Independent security review handoff

An independent security assessment has not been performed. This document prepares a concrete review; it is not an attestation or certification.

## Scope

Review the production Next.js API, Better Auth password/MFA flows, tenant-pinned Entra OIDC, explicit identity linking, SCIM User lifecycle, domain/project authorization, encrypted provider/evidence/baseline storage, signed CI endpoints, isolated hosted unit/browser VMs, and AWS Device Farm orchestration.

## Evidence available

- `test/account-access.test.ts`: domain restrictions, old sessions, verified-email changes, role/MFA controls, invite boundaries and report delivery.
- `test/enterprise.test.ts`: cryptographically signed OIDC fixtures, state/nonce/signature/audience/tenant rejection, explicit linking, MFA/enforcement, scoped directory tokens/deactivation, visual approval concurrency, unit-VM contracts and AWS orchestration limits.
- `test/hosted.test.ts`: credential isolation, source identity, callbacks and cancellation.
- Engine `test/portal-visual-export.test.js`: candidate identity/digest validation.
- Reproducible dependency audit: `npm ci` then `npm audit --omit=dev --audit-level=high`.
- Product-scoped audit exports from the authenticated dashboard.

## Assessment work still required

Use authorized staging tenants, disposable devices and synthetic data. Validate Entra configuration and SCIM interoperability against a real company tenant; test employment offboarding, recycled email addresses and owner recovery. Independently attack tenant isolation, ID-token validation, login/linking races, provisioning reactivation and domain-policy transitions. Review VM escape defenses and provider network enforcement with malicious test fixtures. Review key rotation, data retention, encrypted backups and deletion obligations. Exercise AWS IAM scoping, upload provenance, billing limits, uncertain scheduling reconciliation, cancellation and artifact access using a controlled account.

Evaluate accessibility with assistive technology and usability with representative users; automated checks alone do not establish the quality of every user experience. Evaluate requirements, business rules, performance/security testing and defect recall against a labeled real-product pilot.

The account owner must select and authorize an independent assessor and arrange access. The implementation author cannot supply independence by reviewing their own code.

## 2026-10-30 hardening additions for assessor review

The scope now includes hosted per-connection DNS pinning (HTTP/CONNECT/API
oracles), stable directory identity bindings and effective manual offboarding,
server-recomputed frozen execution coverage, version-bound retained evidence,
archive destination/claim/receipt binding and reconciliation, execution recovery,
retry budget reservations and paginated release-history exports. Review both
`test/enterprise-hardening.test.ts` and engine `test/network.test.js`, plus the
controlled real-browser workflow and isolated PostgreSQL recovery harness.

Local dependency audits reported no production advisories at this verification;
that is neither a penetration test nor independent assurance. No real company
Entra tenant, physical-device account, customer backup or assessor was supplied.
The implementation author's tests cannot close those external evidence items.

## Launch reviewer package

`tools/launch/package-review.py` exports selected repository files, source revisions,
diffs, SHA-256 inventories, dependency locks, public Docker recipes and synthetic
launch evidence into an ignored local archive. It excludes `.env*`, `.local`,
`.vercel`, `.git`, dependencies, build output, symlinks and production data. Supply
reviewed engine and optional Java checkout paths through the documented environment
variables; no cloud key or customer source is required for packaging. Verify the
external archive digest and per-file `SHA256SUMS` before review. Source snapshots
for measurements have their own manifests; a later documentation commit is not
silently represented as the measured source.

Trust boundaries to attack:

1. Browser → authenticated Next API: owner/admin/QA/viewer, recent MFA, trusted
   devices, explicit project membership and domain/SSO rechecks on every artifact.
2. Tenant → shared PostgreSQL: row/project scope, ten-connection pool, serialized
   fair claims, company quota membership, reservation lifetime and deletion/reset
   resistance. Company grouping is capacity accounting, not a new authorization grant.
3. API → Vercel microVM: provider create ambiguity, time/concurrency/stage bounds,
   bootstrap/source/model credential separation, callbacks and cancellation races.
   Local Docker tests do not attest Vercel's microVM implementation.
4. API → model/GitHub/preview/AWS/email/Slack: exact approved endpoints, server-held
   scoped credentials, read-only source, authorized preview mutations and recorded
   external data transfer. Restricted-domain notification prohibition remains.
5. Database → hosted Ledger → optional Java archive: encrypted payload versus
   immutable receipt digest, destination/claim/receipt binding, retention, external
   head custody and administrator replacement threat. Java is not deployed here.
6. Operator → deployment/backup/queue: secret custody, drain monitoring, additive
   migrations, unknown provider costs, backup/key/deletion recovery and rollback.

Reproduce engine offline tests from `tools/test-image`; website `npm test`,
typecheck/build; workload labels, snapshot/runtime preparation, local PostgreSQL
load/recovery and challenge scripts under `tools/launch` and `test/launch`.
No public-company or former-employer repository is needed. Run paid integration
matrices only after scoped company consent and explicit budgets.

A finding must identify reviewer/name/organization, review date and scope,
independence/conflict statement, affected revision/environment, reproduction,
expected/actual behavior, severity, evidence hashes, owner, remediation revision
and external retest result. Start from `tools/launch/reviewer-findings.template.json`.
Retain unresolved findings; do not replace an authentic result with an internal
interpretation. No external findings were supplied or invented. The initial
challenge's two missed integrity regressions are **internal** findings and their
post-discovery closure is not independent security assurance.
