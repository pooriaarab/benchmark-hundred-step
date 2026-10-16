# Changelog

## 0.2.0

Scoring fixes from an independent deep review. 0.2.0 scores are not
comparable with 0.1.0 scores: the old grader could be gamed into `final=true`
with zero recoveries, and partial credit worked differently.

What changed:

- `DEPENDENCY_MISMATCH` no longer reveals the expected token, so an agent must
  track tokens from tool results instead of reading them out of errors.
- A wrong probe call no longer masks a scheduled fault: injected transient and
  rollback faults now fire regardless of pending state, so `recoveries=0` with
  `final=true` is impossible.
- `advance` calls past the final step are rejected with `WORKFLOW_COMPLETE`
  instead of silently extending the episode and voiding the success flag.
- Unfinished episodes earn survival-proportional partial credit, so stopping
  one step early no longer scores ~0.74. The weights for finished episodes are
  unchanged (survival 60%, final success 25%, recovery 10%, rollback 5%).
- Run limits now scale with task length: `timeoutMs`, `maxTurns`, and
  `maxToolCalls` derive from the longest selected episode in the CLI `run`
  command, the SDK `run`, and the MCP `run_benchmark` tool, replacing the
  unusable 60 s / 12-turn / 24-call defaults.
- Run reports on every surface (SDK, CLI, MCP, and JSON output) now include a
  `breakdown` with a survival curve by step and a per-length table.
- Added `--tasks <file>` to the CLI, `tasksPath` to the SDK `run`/`score`, a
  `tasksPath` argument to MCP `run_benchmark`, and `createApiHandler` for
  serving a generated split file such as a held-out set.
- Hidden split generation requires an explicit private `--seed` (the published
  0.1.0 default seed is retired), emits `hs-` prefixed ids, different workflow
  names and prompt wording, seed-shuffled order, and lands outside `data/` and
  the npm package.
- Task rows now carry `expected.terminalToken`, the token a complete episode
  ends on, making the expected answer explicit per split.
