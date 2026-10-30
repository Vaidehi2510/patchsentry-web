# Automatic QA and weekly reporting

Configure a project once in **Automation & reports**. Signed GitHub/CI events request QA automatically; there is no need to click a run button for every change. Manual assessments remain available for investigation.

## Authorization and setup

1. Connect your model and approved test expectations. Define business rules, user roles and critical journeys in Product QA, and link each important requirement to explicit goals/checks. The frozen product plan is supplied to the AI team as requirement context; models cannot silently rewrite the expected outcomes.
2. In Integrations, verify a fine-grained GitHub token whose account is a repository administrator. Keep source scopes read-only: Contents and Metadata, with Pull requests, Actions and Deployments read access for selected event types. Administrative repository authority is rechecked before automatic dispatch, independently of Patchsentry team roles.
3. Issue the project signing secret. Add the displayed URL and secret in GitHub repository settings → Webhooks, selecting application/json and the relevant events. The secret is displayed once and stored encrypted, separately from model and source credentials. Rotation invalidates old signatures.
4. Select events, successful CI workflow names, disposable deployment environments, exclusions and a daily admission limit. Save with automatic QA enabled. Production deployments are excluded. Source code is never edited by setup or execution.

Webhooks provide immediate delivery. Optional daily reconciliation scans a bounded page of open PRs to recover missed deliveries and apply the same authorization, exclusions, immutable contracts and budgets. Large repositories are paginated; a scan is not proof that every historical change was tested. Existing projects stay disabled until an administrator opts in. The old GitHub QA controller remains disabled.

## Events and exceptions

- **PRs:** new commits, ready-for-review, reopening and label changes. Drafts are excluded by default. Current state, source SHA, labels and branch are reread from GitHub.
- **CI:** only named successful workflows, with exactly one associated current PR. Workflows without a unique PR use a signed exact-build manifest.
- **Deployments:** selected non-production preview environments, with the latest successful status and exactly one current open PR at that source revision. The saved approved preview URL is used; arbitrary webhook URLs are not followed.
- **Published releases:** select exactly one asset by its name or `*` pattern. GitHub must supply its computed SHA-256, and the release tag must resolve to an immutable source commit. Missing/ambiguous artifacts remain untested. No digest is guessed from a tag or filename.
- **Signed CI manifests:** identify a PR, CI build or release with its exact source and artifact identity. A build's source branch is verified against GitHub.

Exceptions include branch patterns, labels, PR numbers and build/version patterns. Patterns are case-insensitive and support only `*`, never arbitrary regular expressions. Excluded work is reported as intentionally omitted, not passed.

Delivery identities deduplicate transport retries. A second trigger for the same subject, revision and frozen configuration reuses the existing assessment. Configuration recovery may queue a previously blocked job only when it has never attempted execution and its immutable inputs still match. Attempted, interrupted or failed paid work never silently receives a new inference budget. Capacity and budget deferrals remain visible in event history and weekly reports.

The initial hosted pilot allowance remains two concurrent workers and eight admitted starts per UTC month across this deployment. Project daily admission and inference reservations apply additionally. This allowance is not enterprise-scale execution capacity.

## CI build/version manifest

Store `QA_AUTOMATION_URL` and `QA_AUTOMATION_SECRET` in CI secrets. Use the project's `/ci` URL, never an OpenRouter key or runner token. The publisher signs the exact JSON body and reads a job-specific result using the same project signature.

```json
{
  "repository": "your-org/your-product",
  "branch": "main",
  "actor": "your-ci-service",
  "request": {
    "revision": "0123456789abcdef0123456789abcdef01234567",
    "target": {
      "kind": "release",
      "name": "v2.0.0",
      "platform": "web",
      "artifactSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    "hostedArtifactUrl": "https://builds.example.com/product-v2.zip"
  }
}
```

```sh
node scripts/publish-ci-assessment.mjs manifest.json
```

The script waits up to 20 minutes and exits unsuccessfully if QA is blocked, fails, lacks evidence or cannot finish. A `202 Accepted` webhook is never a passing result. Configure the next deployment step to require this command's success. Use `--no-wait` only for an intentionally asynchronous notification workflow. CI-provided actor names are attribution from CI, not independently verified human identities.

Previews must expose the actual deployed source SHA in `x-qa-revision`; build/release previews also expose `x-qa-artifact-sha256`. Hosted artifact bytes are hashed before inspection, never extracted or executed. Private GitHub asset authentication is restricted to the exact repository asset API endpoint and is dropped before following an approved GitHub asset-CDN redirect.

## Functional and UI evidence

Trusted goal assertions now support a same-origin **API GET response** status and optional JSON-pointer/scalar expectation, using the browser's synthetic session cookies. An order journey can assert the confirmation screen plus order amount, status and owner through its API. A role journey should verify the signed-in identity as well as the expected denied endpoint. API responses need matching deployment identity headers; bodies are bounded to 64KB, redirects are refused, and raw cookies/bodies are excluded from reports. Bearer tokens kept only in application local storage are not automatically extracted.

**Keyboard focus** assertions and approved navigation keys complement responsive/layout, accessibility and broken-interaction checks. Browser journeys are independently replayed. Visual regression comparisons require accepted baselines; persistent hosted baseline management remains unavailable.

Bug records retain expected/actual behavior, reproduction steps, affected source/build, severity and advisory fixes. Opted-in retained evidence can include screenshots and sanitized JSON execution traces. Screenshot pixel redaction is not guaranteed. Flaky-test investigations are tracked separately from product-defect false-alarm metrics, never muted into passing release coverage, and require a passing independent replay or second matching-revision/frozen-plan report before resolution.

## Weekly dashboard, email and Slack

Each report covers a completed UTC Monday–Monday week. It includes received assessments and exact versions, executed check counts, current-plan requirement links, intentional omissions, blocked/waiting jobs, unresolved high-risk bugs, retained evidence and known/unknown model costs. It never treats missing results as success or claims exhaustive product coverage. Reports are stored before optional delivery and can be downloaded as JSON.

Weekly processing has a protected Monday schedule plus daily catch-up. Reports and email claims are deduplicated. Email delivery is optional and addressed only to the current verified project owner. Company teammates use their authorized dashboard access or the shared Slack channel. Slack is optional: connect a bot token with `chat:write`, invite it to the intended channel, and select the channel/events in Team & operations. The encrypted cloud connection needs no customer-managed connector. Ambiguous SMTP/Slack delivery remains `uncertain` and is not automatically resent.

## Scope still requiring integration or independent validation

Project permissions, repository verification, MFA, audit exports and retention are implemented. **SSO/SCIM is not implemented**, managed physical-device fleets are not provisioned, and no independent security assessment/certification is claimed. Existing enrolled native/Appium and isolated test-suite paths need real devices/test infrastructure and evidence. Hosted authored unit-test execution and persistent hosted visual baselines remain separate gaps. Weekly reports expose these boundaries rather than presenting the product as a complete replacement for every QA function.
