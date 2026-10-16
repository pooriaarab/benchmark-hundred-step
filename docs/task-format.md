# Task format

Each JSONL row is an episode with a stable ID such as
`inventory-reconciliation-75`. Hidden-split rows carry an `hs-` prefix such
as `hs-crew-rostering-75`.

- `prompt` tells the agent the step count and recovery protocol.
- `input.workflow` names the workflow family.
- `input.length` is 25, 50, 75, or 100.
- `input.initialToken` starts the dependency chain.
- `expected.completedSteps` is the full length; `expected.terminalToken` is
  the token a complete episode ends on.
- `metadata.seed` selects the task's deterministic tokens and failures.
- `metadata.split` records `public` or `hidden`.
- `metadata.failures` lists injected step numbers and either `transient` or
  `rollback` behavior.

Run a split file with `--tasks <path>` on the CLI, `tasksPath` in the SDK
`run`/`score`, `serve --tasks <path>` for the API, or `tasksPath` on the MCP
`run_benchmark` tool.

## Tools

`advance({ step, token })` accepts only the next step and the exact token from
the preceding successful call. It returns the next token when successful.

`rollback({ checkpointStep, token })` is available only after a rollback fault.
Both arguments must match the checkpoint in the fault response. A successful
rollback authorizes an exact retry; it does not skip or silently complete the
failed step.

## Reproducibility

The generator uses a local Mulberry32-style pseudorandom stream to select
failure positions. Token derivation is deterministic and independent of the
model or wall clock. The simulator takes its seed from task metadata, so a
trace has the same score through the SDK, CLI, MCP server, and HTTP API.
