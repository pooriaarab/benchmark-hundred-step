# Hundred Step provenance

This file is generated from the benchmark definition.

## Seeded dependent-workflow state machines

- Kind: `synthetic`
- URL: https://github.com/pooriaarab/benchmark-hundred-step/blob/main/scripts/gen-tasks.mjs
- Licence: `MIT`
- Retrieved: 2026-10-15T00:00:00.000Z
- How to get it: Run `node scripts/gen-tasks.mjs --seed 20261015 --split public` from the repository root.
- Contamination notes: The 24 public tasks use seed 20261015. For final comparisons, generate seed 20271015 with `--split hidden`, keep the resulting file out of the repository and npm package, and disclose the seed after evaluation.
- Refresh: Regenerate annually or after simulator changes, review the JSONL diff, and publish a versioned release.
