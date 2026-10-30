# Company domain access

Each product project has its own membership, roles, DNS challenge and domain policy. A verified email at the company domain is necessary for a restricted project; it never grants access on its own.

## Configure

1. Sign in as the project owner using a verified company email. Complete MFA, then open **My account → Company access & domain** for the product.
2. Enter a domain you are authorized to administer, such as `gwu.edu`. Ask its DNS administrator to publish the exact TXT name and value shown. Challenges expire after 24 hours.
3. Check DNS verification. A value for another project does not verify this one.
4. Resolve any incompatible members listed. Every member, including the owner, must have a matching verified email. Remove outside members in **Team**, or have them verify a matching address through **My account**.
5. Choose **Require @domain membership**. Invitations to outside addresses are revoked. Invite matching addresses in **Team**, choosing Admin, QA engineer or Viewer for this project.

Only the owner can create, replace, remove or toggle a domain policy, and those changes require MFA verified within 15 minutes. Admins can view the configuration and invite matching teammates. Turning off the restriction does not grant anyone membership or re-enable report delivery automatically.

## Enforcement

Authenticated project requests check the current database email and its verified status, in addition to project membership and role. The project listing, results, evidence downloads, audit exports, weekly reports and configuration use this gate. An existing session does not bypass a changed email or domain policy. Matching is exact and case-insensitive: `person@gwu.edu` matches `gwu.edu`; `person@dept.gwu.edu` and `person@gwu.edu.other.example` do not.

An owner cannot change to an outside email while owning a restricted project. The database also blocks completion of an older email-change confirmation that would strand the owner. Other members who change to outside addresses lose project access. Remove their membership when offboarding; restoring a matching verified address otherwise restores their existing membership.

## Report delivery and trusted integrations

Restricted projects keep report contents in the authenticated dashboard. Email and Slack report delivery is blocked, including weekly summaries and pending connector notifications. Invite messages can still go to matching addresses. Previously downloaded copies, already delivered messages and a delivery already in flight cannot be recalled.

Domain restrictions govern human access; existing project-scoped machine credentials, signed CI integrations, read-only GitHub access and approved AI providers remain trusted integrations. Review and rotate service credentials when offboarding people who held them. These credentials authorize machines independently of human email domains. Domain restrictions do not change what a selected AI provider receives during approved QA inference.

DNS verification proves domain control at verification time. It does not verify continuing employment, revoke company email accounts, automatically provision members, provide SAML/OIDC sign-in or implement SCIM. Company identity-provider SSO and lifecycle provisioning are separate capabilities and are not implemented by this feature. Existing password and email/authenticator MFA remain in use.
