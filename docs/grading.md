# Grading

The grader replays the submitted tool log against a fresh deterministic state
machine. It never trusts a submitted final state or asks a model to judge one.

## Failure modes recorded before implementation

The grader can be wrong if it accepts a guessed dependency token, permits a
step to be skipped or repeated, treats an error as progress, lets a retry use
different arguments, accepts rollback without the issued checkpoint, counts a
recovery twice, trusts a model-authored final state, or changes with replay
seed. It can also overreward an agent that stops early if completion dominates
the partial-progress metric.

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
