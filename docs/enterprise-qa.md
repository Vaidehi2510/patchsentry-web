# Enterprise QA setup and evidence boundaries

## Company SSO: Microsoft Entra ID

This supports any verified company domain and its own Entra tenant. There is no GWU-specific tenant, email rule or application registration.

1. The Patchsentry project owner verifies their company domain and enables domain-restricted membership in **My account**. Their own verified email must match.
2. The company identity administrator registers a **single-tenant Web application** in Entra. Register `https://patchsentry.vercel.app/api/enterprise/callback` as its redirect URI. Use authorization code flow with OpenID Connect, and configure the email or preferred_username claim to match members’ verified company emails.
3. In **My account → Microsoft Entra ID & directory**, the owner saves the tenant ID, client ID and client secret **value** in the secure fields. Never share secrets in chat. Secrets are encrypted with project-specific authenticated encryption; browser responses never return them.
4. Invite members to this product. Each member signs in with their verified Patchsentry account and MFA, then links their own Microsoft account. For a new member of an SSO-required project, use **My account → Link a company Microsoft account** and the project sign-in ID. An email match alone never links identities.
5. Test **Microsoft sign-in** from the login page, supplying the project ID, then complete Patchsentry MFA. The owner can require SSO only after testing this path and linking every existing member. Requiring SSO rejects ordinary password sessions for that project immediately.

Tenant, audience, issuer, signed ID token, subject/object ID, nonce, browser-bound state and PKCE are checked. Callback states expire in ten minutes and work once. Changing the connection invalidates old SSO generations, links and directory tokens. Local MFA remains required at each company sign-in, regardless of upstream MFA claims. Existing local account password/MFA setup remains the enrollment path; this release does not create new accounts merely from an IdP email claim.

Entra setup requires authorization from the company’s identity administrator. Domain ownership does not grant authority over its Microsoft tenant. Google Workspace, Okta and SAML connections are not provided by this Entra-specific implementation.

## Project directory provisioning: SCIM Users

The owner issues a one-time directory bearer token in the same panel and configures the displayed `/api/scim/PROJECT_ID/v2` URL in company provisioning. Tokens are stored as SHA-256 digests, can be rotated, and cannot address another project.

Supported resources: Users, ServiceProviderConfig and ResourceTypes. Users support create/read/list, exact `userName eq` / `externalId eq` filters, bounded pagination, update, add/replace PATCH of identity/lifecycle attributes, and deactivation/delete. Configure Entra attribute mappings for `userName` (the company email), `externalId` and `active` only. Groups, name/displayName profile updates, arbitrary filter expressions, group-to-admin mapping and directory-driven changes to a verified account’s email are unavailable. Unsupported operations return errors rather than pretending to apply.

A provisioned matching verified account receives Viewer membership. A person not yet registered must complete normal inbox verification and MFA first. Owners can review roles in Team. Deactivation removes membership/invitations, suspends linked company identities and invalidates that project’s SSO sessions. Removing a directory resource retains an inactive tombstone. Reusing email addresses requires identity review; do not use optional SSO as an employment-lifecycle control. Require company SSO after onboarding.

## Hosted authored Node unit tests

Enable Node tests in the test library. New hosted assessments freeze their source hashes. A separate disposable VM fetches the exact source revision without hooks or install/build scripts. The read-only GitHub credential is erased before test execution. The VM then enforces **deny-all networking**. Tests run as an unprivileged user, with an empty environment, read-only product files, restricted Node filesystem access, no subprocess permission and bounded runtime/memory.

The unit VM never receives model keys, portal tokens or job callback credentials. It stops before the browser/model VM starts. Results are merged from server-retained unit evidence; a browser worker cannot invent a passing unit result. Missing, skipped, timed-out or incomplete evidence blocks readiness. No dependencies are installed: use existing Node/core-compatible product modules, or import your existing CI suite results for other frameworks. Hosted unit execution uses additional bounded compute; infrastructure cost remains unknown unless measured.

## Persistent hosted visual baselines

Enable evidence uploads in the quality policy and screenshot comparison in Testing setup. First runs capture revision-bound candidates and remain blocked without approved baselines. In **Testing setup → Review your expected UI**, an owner/admin compares images and explicitly approves the reviewed revision after recent MFA. Approved images are encrypted and scoped to the product. Acceptance uses the previous digest to reject stale competing approvals. It never rewrites a completed report.

Subsequent workers receive the accepted baseline snapshot. Missing/changed pixels block or fail comparison. Baseline changes during execution block stability checks; changes after execution invalidate signed CI release decisions. Limits: twenty accepted images / 8 MB and one hundred candidates / 20 MB. Remove reviewed candidates as needed; scheduled maintenance expires candidates under the evidence retention policy. Baselines survive candidate deletion and remain until explicitly removed/replaced by an admin or the project is deleted. Private runners continue using their independently enrolled baseline directory.

## AWS Device Farm physical-device integration

In **Team → AWS Device Farm**, the owner connects scoped IAM credentials (prefer temporary credentials), an owned us-west-2 project and an owned device pool. Access is verified without starting paid sessions. AWS account/resources, uploaded application and Appium Node package must already exist. AWS fees and required app signing remain the company’s responsibility.

Runs use AWS-accepted uploads in that exact account/project, select at most two compatible devices, enforce a fifteen-minute timeout per device, and allow one active run per product with a one-to-five-run daily limit. Ambiguous scheduling is never retried automatically; reconcile the confirmed AWS run ARN from the console. The dashboard polls active runs; scheduled maintenance also refreshes provider evidence. AWS device results and minutes are included separately in new weekly reports. Signed artifact download URLs are never exposed in reports.

For automatic native CI, explicitly enable signed device CI in the connection, connect repository-admin-authorized read-only GitHub access, and issue the Automation signing secret. POST the exact JSON body to `/api/devicefarm/PROJECT_ID/ci` with `x-hub-signature-256: sha256=<HMAC-SHA256 of raw body>` using that secret. The manifest contains `idempotencyKey` (UUID), `revision` (full SHA), `version`, `platform` (`android` or `ios`), `appArn`, `testPackageArn`, `artifactSha256`, and `reviewedUploadProvenance: true`. The repository administrator and commit are reverified before scheduling. Use the same idempotency key on delivery retries.

The source SHA and application digest are a reviewed builder declaration, **not an independent hash of AWS’s stored upload**. Device results cannot alone approve a production release or establish source/model review coverage. Actual AWS-account/device pilot validation remains necessary before claiming real hardware coverage for a product.

## Independent assessment

Dependency and security regression checks are part of development, not independent certification. See [security review handoff](security-review.md) for scope and remaining validation. No external assessor, company Entra tenant or AWS device account was configured by building these features.
