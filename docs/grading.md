# Grading

The grader replays the submitted tool log against a fresh deterministic state
machine. It never trusts a submitted final state or asks a model to judge one.

## What the simulator enforces

- `advance` accepts only the next step number and the exact token returned by
  the previous successful step. A mismatch returns `DEPENDENCY_MISMATCH`, which
  names the expected step but never the token; the token only ever appears in
  successful results and in rollback errors issued to a caller that already
  holds it.
- Seeded faults always fire. A transient fault needs an exact retry; a
  rollback fault needs `rollback` with the issued checkpoint step and token,
  then an exact retry. A wrong probe call cannot make a scheduled fault skip.
- Calls past the final step return `WORKFLOW_COMPLETE` and cannot extend the
  step count or void a finished episode.
- An error is never progress. A retry with different arguments is a fresh
  dependency mismatch, not a recovery.
- The run report (`run` CLI output, JSON, SDK, and MCP) carries a `breakdown`
  with the survival curve by step and a per-length table.

## Metrics

- **Survival:** correctly completed steps before the first error left
  unrecovered, divided by task length.
- **Final success:** every step completed and every injected failure handled.
- **Recoveries:** injected failures resolved by an exact retry or rollback.
- **Rollback correctness:** required rollbacks made at the issued checkpoint.

The composite gives survival 60%, final success 25%, recovery rate 10%, and
rollback correctness 5%. An unfinished episode multiplies its non-final
components by survival again, so partial credit decays quadratically with
progress rather than linearly. A task with no progress receives zero rather
than credit for having no rollback mistakes.

## Ways the grader can fail

The grader would be wrong if it accepted a guessed dependency token, permitted
a step to be skipped or repeated, treated an error as progress, let a retry
pass with different arguments, accepted a rollback without the issued
checkpoint, counted a recovery twice, trusted a model-authored final state,
or changed with the replay seed. It could also overreward an agent that stops
early if partial progress dominated, or one that probed errors to skip or read
out dependency tokens.

The E2E gate therefore replays complete traces and challenges the grader with
empty submissions, constant answers, an always-refusing answer, a repeated
identical tool call, and an error-reading policy that never tracks tokens of
its own, over every task. Complete traces must score 1; every trivial strategy
must score below 0.2; a trace stopped one step short must stay below 0.75.
