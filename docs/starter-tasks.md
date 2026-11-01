# Scoped starter contributions

These are real remaining tasks, not completed contributions or fabricated bug
reports. Published issue URLs are recorded below after creation. No person is
assigned or contacted automatically. Read CONTRIBUTING.md and SECURITY.md first.

## Public reviewer-guide accessibility observations (website)

Use the public /open-source and /demo pages with a real screen reader and keyboard.
Acceptance: record assistive technology/browser/OS versions; check heading and
anchor navigation, code blocks, evidence table scrolling, video captions/transcript,
and 200% zoom; provide reproducible sanitized observations and distinguish manual
checks from automated axe results. No account, private product or provider key.
A focused confirmed UI fix is welcome after agreeing scope.

## No-key quick-start on Windows (engine)

Use a clean Windows checkout and Node24 in PowerShell. Acceptance: record Node/npm/
Windows versions; run npm ci --ignore-scripts and both demos without credentials;
confirm healthy4/4 and seeded expected0/actual5 failure; identify mocks, temporary
cleanup and any real portability failure. Update the guide only for confirmed
platform differences. Do not add secrets or enable scheduled controllers.

## Plain-language QA status glossary (website)

Document passed, failed, blocked, skipped/unsupported and pending results against
actual contracts/tests. Acceptance: give one synthetic example per supported status,
explain required-check score versus code coverage and source/build freshness, link
actual source/tests, and identify explicitly unknown outcomes. Review wording from
a newcomer perspective. Do not invent new statuses or claim complete defect recall.
