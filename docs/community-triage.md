# Prepared maintainer triage for historical engine work

These are reviewed drafts, not posted messages or closed records. The external
contributor has not been contacted by this preparation. A maintainer may approve
publishing the explanations below. Repository state should be rechecked first.

## Engine issue4: old scheduled QA sync failures

https://github.com/Vaidehi2510/QA-testbot/issues/4

Proposed disposition: close as completed for the reported schedule-failure problem.

Draft reply:

> The architecture has since moved on: `.github/workflows/qa-sync.yml` and the old
> `qa-bot/` paths are no longer present. The current standalone controller is
> `.github/workflows/qa-control.yml`, and GitHub reports it as `disabled_manually`;
> it has not been re-enabled. The reviewer/demo path makes no GitHub calls and
> needs no credentials. The README now distinguishes hosted execution, optional
> private runners and the separately enrolled controller. The reported legacy
> schedule is no longer active, so this issue can close without adding secrets
> or restoring the superseded workflow. Thank you for identifying the noisy runs.

## Engine issue5: tests for the former qa-bot modules

https://github.com/Vaidehi2510/QA-testbot/issues/5

Proposed disposition: close as not planned because the requested paths and roster
coverage design are superseded; do not claim the original checklist was implemented.

Draft reply:

> This request targets the former `qa-bot/planner.js`, `coverage.js` and sign-off
> design. Current execution uses `src/planner.js`, structured required-check
> outcomes and the test suite under `test/`; it intentionally does not track a
> reviewer participation quota or missing-roster coverage. The old paths are not
> the current implementation. The no-key reviewer guide links the exact current
> verification commands and remaining boundaries. Closing this obsolete scope as
> not planned; any reproducible gap against current paths should receive a new
> focused issue rather than restoring the old architecture. The earlier report
> and contribution history remain available.

## Engine PR6: disable old qa-sync schedule

https://github.com/Vaidehi2510/QA-testbot/pull/6

Proposed disposition: close unmerged. Do not merge an old README/workflow patch
that describes deleted qa-bot paths as active.

Draft reply:

> Thank you for the schedule-noise fix. Its base describes the old `qa-sync.yml`
> and `qa-bot/` implementation, which has since been replaced. Applying this patch
> now would restore obsolete setup guidance. The current QA controller remains
> manually disabled, and the README/reviewer guide documents the actual execution
> paths. Closing this PR unmerged as superseded; the historical PR remains intact.
> Your earlier merged state-persistence contribution in PR1 is credited in the
> reviewer/contributor material. No new credentials or scheduled QA are enabled.

Peer outreach and any descriptions of a contributor's personal role need their
actual participation. Public GitHub account attribution is not a claim about
identity, discipline, adoption or a large human community.
