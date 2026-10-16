# Grading

The grader replays the submitted tool log against a fresh deterministic state
machine. It never trusts a submitted final state or asks a model to judge one.

## Failure modes recorded before implementation

The grader can be wrong if it accepts a guessed dependency token, permits a
step to be skipped or repeated, treats an error as progress, lets a retry use
different arguments, accepts rollback without the issued checkpoint, counts a
recovery twice, trusts a model-authored final state, or changes with replay
seed. It can also overreward an agent that stops early if completion dominates
the partial-progress metric. An error message that leaks the expected token, or
a scheduled fault skipped because a pending state was already open, lets an
agent finish with zero recoveries, and `advance` past the end must be rejected
so it cannot void a finished episode.

The E2E gate therefore replays complete traces and challenge the grader
with empty, random, always-yes, and repeated identical calls. Complete traces
must score high; every trivial strategy must score below 0.2.

## Metrics

- **Survival:** correctly completed steps before the first error left
  unrecovered, divided by task length.
- **Final success:** whether every step completed and every injected failure
  was handled.
- **Recoveries:** injected failures resolved by an exact retry or rollback.
- **Rollback correctness:** required rollbacks made at the issued checkpoint.

The composite gives survival 60%, final success 25%, recovery rate 10%, and
rollback correctness 5%. A task with no progress receives zero rather than
credit for having no rollback mistakes. Per-task reasons report the survival
point, allowing reports to form a survival curve by step and task length.

For unfinished episodes the survival, recovery, and rollback terms are scaled
by survival: the score is `(final ? 1 : survival) * (0.6 survival + 0.1
recovery + 0.05 rollback) + 0.25 final`, so stopping one step early no longer
scores a flat ~0.74.
