# Reviewer material verification

This record covers the reviewer/contributor changes, not independent platform
assurance or a new customer pilot. Existing project settings, keys, default
capacity, source permissions and release qualification were not changed.

## Published source

- Engine `aadc83c5b374b96d7dea0ceab8d71fc1da12bb50`: reviewer quick-start and
  contribution/security policies; no runtime code or dependency changes.
- Website application `c77dccbc482def32c7a40b28daa6d07f5597e306`: public guide,
  static captured assets, accurate documentation and navigation. A subsequent
  documentation-only commit records these verification results and task URLs.
- Java `378e8cc7a1ea490ef60dfdecfa9e6ad56894ed75`: reproduction/deployment clarity
  and contributor policies; no service code or dependency changes.

The annotated `ospo-2026-review` tag in each repository freezes this review
snapshot. It is not a certification, an award result or a production-readiness label.

## Execution and browser checks

Both keyless engine demos passed on the maintainer Node26.3.1 host and offline
Linux/arm64 Node24.22.2. The healthy fixture passed4/4; the seeded boundary had
3 passes/1 failure and expected0/actual5. The demo command passed because these
expected outcomes matched. External integrations and optional model replies were
mocked, no live model called, and original source hashes remained unchanged.

The website type check and production build passed. Real Chromium checked the
public guide at1440,768,390 and320px: no document overflow or detected axe WCAG2A/
AA/2.1AA violations; no page errors. This automated result is not a screen-reader
usability assessment. The recorded WebM played at1280x720 for132.52s. All8 English
caption cues parsed and cover its duration; the full transcript and report assets
loaded. No account or customer data was used in browser verification.

## CI and deployment

- [Engine CI passed](https://github.com/Vaidehi2510/QA-testbot/actions/runs/41363219934).
- [Website application CI passed](https://github.com/Vaidehi2510/patchsentry-web/actions/runs/41363252957).
- [Java tests and disposable kind smoke CI passed](https://github.com/Vaidehi2510/Patchsentry-Ledger-Java/actions/runs/41363228772).

The first Vercel deploy request returned Not authorized. Identity/project/team
reads confirmed the expected existing owner; one retry with the explicit existing
team scope succeeded, without permission changes, reauthentication, plan changes,
Git metadata removal or new hosting infrastructure.

Production is READY at https://patchsentry.vercel.app/open-source, deployment
`dpl_AvL4udtT38ts8ktJByQWjbWNP423` / `patchsentry-jsj9iuqy7-vaidehipandya-3024s-projects.vercel.app`.
The public guide returned200, and all10 published artifact SHA-256 values matched
`public/review/artifact-manifest.json`. Unauthenticated capacity/operations probes
returned401. The engine QA controller still reports `disabled_manually`.

## Community work

All three repositories now contain CONTRIBUTING, custom CODE_OF_CONDUCT, SECURITY,
issue forms and a PR template. YAML structure, local policy links, JSON/source
artifact hashes and whitespace checks passed. The canonical engine CITATION.cff
contains software attribution, not a DOI or a publication claim. Public About
metadata/topics now describe the actual responsibilities.

Three real remaining tasks are [published](starter-tasks.md): Windows reproduction,
manual accessibility observations and a QA-status glossary. No newcomer participation,
testimonial, time saving or cross-disciplinary team is invented. Historical merged
engine PR1 is credited as a GitHub-account contribution without assuming personal
identity or discipline.

Replies/closure of old engine issues4/5 and PR6 remain [prepared drafts](community-triage.md)
until explicitly approved. No reply has been sent to that contributor. Peer outreach
is not automated; the voluntary checklist is ready for actual participants.
