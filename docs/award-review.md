# Patchsentry: reviewer and contributor guide

Public entry: https://patchsentry.vercel.app/open-source. Maintainer: Vaidehi Pandya.
All three repositories are public under the full MIT license. This guide supports
review of the project; it is not an OSPO endorsement or an enterprise certification.

## Problem and intended benefit

Student teams, research-software maintainers and small product teams need to check
changes before release. Patchsentry combines approved requirements/tests, exact
source/build identity, optional model-assisted review and retained release evidence.
Product source stays read-only. Browser actions require an authorized disposable
preview. A passing report covers the configured checks, not the entire product.
No staffing reduction, user adoption or independent AI accuracy is claimed.

## Reproduce the core example

Use Node.js24, Git and npm. Public dependency download is needed once; no account,
model key, Docker, SMTP, GitHub App or target-product credentials are needed.

```sh
git clone https://github.com/Vaidehi2510/QA-testbot.git
cd QA-testbot
npm ci --ignore-scripts
npm run demo
npm run demo:ai
```

Follow the [engine quick-start](https://github.com/Vaidehi2510/QA-testbot/blob/main/docs/reviewer-quickstart.md).
The ordinary demo executes real Node tests. Healthy shipping has four passing tests.
The deliberately mutated synthetic fixture charges$5 at exactly$100; the failed
assertion records expected0/actual5. The original fixture is unchanged and temporary
state is removed. External integrations are mocked; the optional AI demo also uses
mocked provider replies. A successful demo command means all demonstration outcomes
matched expectations, including the deliberate failed product assessment.

[Recorded deterministic transcript](../public/review/deterministic-demo.txt) and
[annotated failed report](../public/review/shipping-defect-report.md) are captured
fixture examples, not customer incidents. Paths in published text are normalized.
The [public UI demo](https://patchsentry.vercel.app/demo) is separately illustrative.
The captioned walkthrough and complete text transcript are linked from the public
guide; it does not demonstrate a paid model, live Slack/GitHub delivery or company SSO.

## Three repositories, one project

| Repository | Responsibility | What a reviewer needs |
| --- | --- | --- |
| [patchsentry-web](https://github.com/Vaidehi2510/patchsentry-web) | Website, accounts/project authorization, job coordination, reports and authoritative hosted assessment Ledger | Public guide/demo need no account. Self-hosting accounts needs a configured database and email sender. |
| [QA-testbot](https://github.com/Vaidehi2510/QA-testbot) | Configured test execution, source inspection, evidence and optional model roles | Start with its no-key shipping demo. Browser/Docker checks need their explicitly prepared dependencies. |
| [Patchsentry-Ledger-Java](https://github.com/Vaidehi2510/Patchsentry-Ledger-Java) | Optional scoped assessment archive | Java21/Maven/Docker for its own reproduction; not required for the core demo. The existing web adapter requires an authorized deployed service. |

Hosted web workers are an available execution path. Private runners are optional
for local inference/private networks/native adapters. The separate engine GitHub
QA controller remains manually disabled; do not enable it to reproduce the demo.
Java kind CI deploys only a disposable test cluster, not a production service.

## Evidence and boundaries

The retained launch snapshot documents177 website and338 engine tests, including
real local browser/Docker checks. These are software test results, not code-coverage
percentages or customer-wide defect recall. See [verification](enterprise-verification.md),
[raw evidence](evidence/launch), [operating recipe](enterprise-operations.md) and
[readiness decision](enterprise-readiness.md). Source manifests/CI links identify
exact measured revisions; current main may contain subsequent documentation changes.

The own-product seeded challenge initially detected2 of4 valid defects and missed2,
with no alarms in2 healthy controls. New adversarial Ledger regressions caught the
original2 misses; that follow-up is not a new held-out recall result. Real AI diagnosis,
manual-work savings, company Entra/AWS interoperability, cloud-scale cost and an
independent security assessment remain unverified. Local load/recovery results are
bounded development measurements, not production SLA or billing commitments.

## Authentic contribution history and next contributors

An earlier external contribution by GitHub account[yagaC64](https://github.com/yagaC64)
fixed QA sync state persistence: [merged PR1](https://github.com/Vaidehi2510/QA-testbot/pull/1).
Credit that historical contribution without implying the old workflow is current.
No cross-disciplinary team, testimonials or new adoption is invented here.

Read [CONTRIBUTING](../CONTRIBUTING.md), [conduct](../CODE_OF_CONDUCT.md) and
[private security reporting](../SECURITY.md). Documentation, keyboard/accessibility
feedback, reproducibility checks, test design and code review are useful contributions.
Starter issues should describe a real remaining task with acceptance criteria;
labels and templates alone do not demonstrate community participation.

For genuine peer evaluation, ask a willing person to run the no-key demo or inspect
the public UI, record their actual OS/Node version, steps, observations and effort,
and open an issue or PR if they choose. A maintainer can then review, act on and
credit the accepted contribution. No invitations or emails are sent automatically.
See [peer-review checklist](peer-review-checklist.md).

## Recreate the screen recording

The optional helper `tools/award/record-walkthrough.cjs` records only loopback
public `/open-source` and illustrative `/demo` pages; it does not sign in, request
QA or contact external people. With reviewed engine/browser dependencies and a
local production build already running, set `PATCHSENTRY_ENGINE_DIR` and
`PS_REVIEW_ORIGIN=http://127.0.0.1:3115`, then run the helper from this repository.
It writes the WebM/poster under public/review and scene timings under artifacts.
The committed VTT/transcript provides silent-video narration. Read the helper
before running it; do not point a recorder at private accounts or products.

Published [artifact hashes](../public/review/artifact-manifest.json) bind the video, captions, transcript and report derivatives. The [offline Node24 deterministic](../public/review/node24-demo.txt) and [mock-model](../public/review/node24-ai-demo.txt) outputs provide a second execution environment; they do not turn mocked responses into live inference.
