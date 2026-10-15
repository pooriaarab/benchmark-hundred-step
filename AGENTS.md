# Working on benchmark-hundred-step

## Commands

- Install with `npm ci`.
- Run the full gate with `npm run ci:local`.
- Rebuild public tasks with `npm run generate:tasks`.
- Check a hidden split with `node scripts/gen-tasks.mjs --seed N --split hidden`.
- Generate provenance after building with `npm run provenance`.
- Add no unit tests. Extend `scripts/e2e.mjs` through a public surface.

## Contracts

Keep the 24 tasks, `WorkflowEnvironment`, deterministic replay grader, and
provenance in sync. Every step must consume the prior step's exact token. Do not
trust `Trace.finalState`; replay `Trace.toolLog`. Record grader failure modes in
`docs/grading.md` before changing grading behavior.

Every public task needs transient and rollback recovery. Keep hidden task files
out of git and npm. Preserve the cheap `--lengths 25` path and the long-run cost
warning. Bad-answer E2E policies must remain below 0.2 and complete reference
traces must score 1.

Never read provider keys from repository files. OpenRouter uses
`OPENROUTER_API_KEY`. OpenAI-compatible providers use `OPENAI_BASE_URL` and
`OPENAI_API_KEY`.

Open an issue before a branch. Use `bhun-<issue>-<slug>` and
`[BHUN-<issue>] Imperative subject`. Keep pull requests below 500 counted lines.
Do not merge your own pull request or push `release`.
