# Captured fixture report — annotated context

This is an executed synthetic shipping-boundary example, not a customer incident.
The expected fee at amount100 is0; the seeded strict comparison returns5.
Four actual Node tests:3 passed/1 failed. GitHub/Slack/Drive and all PR/revision
identifiers below are MOCK values. No notifications, model calls or source writes
to the original product occur. See capture-provenance.json for engine source
commit and fixture file hashes. Temporary paths are normalized below.

---

# QA report: example/shop #102

**PR:** [Introduce a shipping-boundary defect](https://github.com/example/shop/pull/102)
**Author:** author
**Tested revision:** bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
**Environment:** synthetic-fixture
**Run ID / attempt:** ad8ee01a28f30a2177a2718a8b603f31439f42be465df5ffec79019a326c9ac8 / 1
**GitHub Actions run / attempt:** 2 / 1
**Created:** 2026-11-01T23:07:23.704Z
**QA outcome:** failed
**Check counts:** passed: 0, failed: 1, skipped: 0, blocked: 0, execution_error: 0, awaiting_human: 0
**Tests: 4 total, 3 passed, 1 failed, 0 skipped, 0 cancelled.**
**Report upload:** pending
**Test evidence:** [https://github.com/example/qa-bot/actions/runs/2](https://github.com/example/qa-bot/actions/runs/2)

## Affected areas
- General

## Affected user journeys
- None recorded.

## QA plan

| Check ID | Reason / supporting requirement | Expected result | Execution method | Required |
| --- | --- | --- | --- | --- |
| runner-node-tests | Essential baseline suite is required for every revision.; ["calculator.js","PR description","calculator.test.js"] | Orders &gt;=100 ship free; smaller orders cost $5; invalid amounts reject. | automated | Yes |

## Executed checks and results

| Check ID | Status | Details | Evidence |
| --- | --- | --- | --- |
| runner-node-tests | failed | 1 test(s) failed (exit 1). | logs/b461adbff807aeafbe13064d.log; [run artifacts](https://github.com/example/qa-bot/actions/runs/2) |

## Failure evidence
Full logs: [open the GitHub Actions run and its artifacts](https://github.com/example/qa-bot/actions/runs/2).

### runner-node-tests (failed)

1 test(s) failed (exit 1).

Artifact path: `logs/b461adbff807aeafbe13064d.log`.

Log excerpt (test output; truncated when necessary):

    TAP version 13
    # Subtest: orders at the documented $100 threshold ship free
    not ok 1 - orders at the documented $100 threshold ship free
      ---
      duration_ms: 1.000875
      type: 'test'
      location: '<temporary-path>'
      failureType: 'testCodeFailure'
      error: |-
        Expected values to be strictly equal:
        
        5 !== 0
        
      code: 'ERR_ASSERTION'
      name: 'AssertionError'
      expected: 0
      actual: 5
      operator: 'strictEqual'
      stack: |-
        TestContext.<anonymous> (<temporary-path>
        Test.runInAsyncScope (node:async_hooks:226:14)
        Test.run (node:internal/test_runner/test:1382:25)
        Test.start (node:internal/test_runner/test:1242:17)
        startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17)

Excerpt truncated; see the full log artifact.

## Static-analysis findings
- None recorded.

## Skipped, blocked, or untested areas
- None recorded.

## Human questions and decisions
- None recorded.

| Check ID | Decision | Responder | Explanation | Timestamp | Revision | Applicability |
| --- | --- | --- | --- | --- | --- | --- |

## Previous execution attempts
No previous execution attempts recorded for this assessment.

## Remaining limitations
- No feature rule matched; only configured baseline and path-selected suites are planned.
- Required check remains failed: runner-node-tests

Outcome is calculated from structured results and applicable decisions. Report availability is independent of QA outcome.
