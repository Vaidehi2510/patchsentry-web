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
