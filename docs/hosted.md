# Hosted QA

Owners and project admins can configure OpenRouter in **Models & agents** without a runner. Paste the key into the password field and select **Verify and save OpenRouter key**. Verification calls OpenRouter's key endpoint, without inference. Select and save a default model and optional specialist models. The separately authorized synthetic inference check uses at most 32 output tokens and no product data.

Keys are encrypted using AES-256-GCM with a project-specific key derived from the server authentication secret. Only the last four characters and verification time are returned to the browser. Production secrets stay in Vercel. Changing the authentication secret requires deliberate credential migration or reconnection; do not rotate it casually. Removing a saved key prevents future workers from retrieving it; revoke the key in OpenRouter to stop already-authorized provider access too.

## Requesting work

1. Connect an authorized public or private GitHub repository. For private source, open Integrations and connect a fine-grained token limited to this exact repository, with Contents: read-only and Metadata: read-only. The token is verified and stored encrypted, separately from your OpenRouter key. Repository registration is not proof of ownership. An owner can enable repository authorization requirements in Product QA policy.
2. Save a public HTTPS disposable preview, the base branch, browser engines, synthetic inputs and trusted goal assertions in Testing setup. The actual deployed preview must report `x-qa-revision` matching the requested full commit SHA. Redirects and destinations outside the preview policy are blocked.
3. For a web build/release, also supply a direct immutable artifact URL (up to 64 MiB), version/build ID and SHA-256. The worker downloads and hashes those bytes without extracting or executing them. The preview must report `x-qa-artifact-sha256` matching the deployed artifact. Map high/critical product requirements before release QA.
4. Request QA. A frozen job records its expectations, source revision and model limits. A managed Vercel Sandbox starts the pinned engine in a nonpersistent VM. Its network allowlist denies private, loopback, metadata and reserved networks.
5. The engine reads committed Git objects without checking out or executing product code. Product install scripts, builds, native suites are not executed in the browser/model worker. Explicitly enabled authored Node unit tests execute separately in a credential-free offline VM. Browser journeys, independent replays, accessibility/layout checks and model reviews produce separate results. Missing or failed evidence cannot count as a pass.
6. The worker uploads its report using a random capability valid only for that job and lifetime. It cannot enroll another runner, read other jobs or update product code. Optional evidence uploads also require the owner's project policy. Screenshots are synthetic-preview evidence; pixel redaction is not guaranteed.
7. Completion, cancellation or the 15-minute VM limit ends the worker. Closing your browser does not cancel it. Uncertain work is never automatically restarted. Review the previous job before explicitly requesting another run.

## Limits and optional private execution

The initial shared hosted allowance is **two concurrent jobs and eight admitted starts per UTC calendar month across this deployment**, with two vCPUs and a 15-minute worker lifetime. Attempted failed/interrupted work counts toward the allowance. Provider inference caps and project monthly reservations are separate from cloud infrastructure usage. Infrastructure billing is unknown unless measured; reports do not present it as free or zero. Vercel can reject worker creation if its own quota or permissions are unavailable. No account upgrade or additional paid plan is enabled by this feature.

Hosted mode supports public repositories and private repositories with verified read access, using public HTTPS web previews. GitHub App installation, private networks, local-only models, native devices, long-running test suites, other existing language/framework suites use the optional advanced runner or CI report import. Hosted Node unit execution and persistent visual review are documented in the [enterprise guide](enterprise-qa.md). Unsupported coverage remains explicitly blocked. Connecting a local model does not silently fall back to OpenRouter.

## Operator deployment

The website's Vercel runtime authenticates Sandbox operations with its platform OIDC identity; no personal GitHub or Vercel token is passed to workers. `scripts/hosted-engine-revision.txt` pins the public QA engine to a reviewed commit. All bootstrap scripts are traced into the server deployment. Production migrations run before the new site is published.

`CRON_SECRET` protects daily retention cleanup and the operator-only `POST /api/internal/hosted-check` diagnostic. That diagnostic starts one bounded, nonpersistent sandbox and runs actual Chromium, Firefox and WebKit assertions. It sends no product source and makes no model call. It is limited to ten requests per day, and its sandbox is stopped in a `finally` block. Do not expose the operator secret in browser code or logs.

The scheduled GitHub QA controller remains disabled. Hosted work starts from an authorized manual request or an explicitly enabled signed GitHub/CI event policy. Daily reconciliation can recover missed PR events. No GitHub controller schedule or workflow-dispatch permission is required. See [automatic QA and weekly reports](automation.md).
