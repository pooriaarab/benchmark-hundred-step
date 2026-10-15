# benchmark-hundred-step

[![npm](https://img.shields.io/npm/v/benchmark-hundred-step)](https://www.npmjs.com/package/benchmark-hundred-step) [![downloads](https://img.shields.io/npm/dm/benchmark-hundred-step)](https://www.npmjs.com/package/benchmark-hundred-step) [![license](https://img.shields.io/npm/l/benchmark-hundred-step)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#sdk)

[AI Benchmark Index](https://aibenchmarkindex.com/benchmarks/benchmark-hundred-step) · [npm](https://www.npmjs.com/package/benchmark-hundred-step) · [Grading](docs/grading.md) · [API](#http-api) · [MCP](#model-context-protocol) · [llms.txt](llms.txt)

benchmark-hundred-step measures whether an AI agent can preserve dependencies,
recover from faults, and roll back correctly across 25, 50, 75, or 100 tool
steps. Run the complete benchmark offline:

```bash
npx benchmark-hundred-step run --provider mock
```

A real run with the bundled mock policy produced:

```text
# Hundred Step

- Model: `mock:1`
- Score: **41.7%**
- 95% CI: 20.8%–62.5%
- Tasks: 24

| ticket-pipeline-25 | 100.0% | survival=25/25; final=true; recoveries=2/2; rollback=1/1 |
```

The mock deliberately succeeds on some tasks and fails others; its number is a
wiring check, not a model result. The 24 public tasks are synthetic state
machines from the committed generator and seed `20261015`. No third-party task
text is included.

## Install

Node.js 20 or newer is required.

```bash
npm install benchmark-hundred-step
```

## Run a model

Start with the six 25-step tasks to limit cost:

```bash
npx benchmark-hundred-step run --provider mock --lengths 25
```

For OpenRouter, set `OPENROUTER_API_KEY` in your environment and choose a model:

```bash
npx benchmark-hundred-step run --provider openrouter --model "provider/model" --lengths 25 --json
```

Use `--lengths 25,50`, `--lengths 75`, or `--lengths 100` to select other
lengths. Runs containing a 50-, 75-, or 100-step episode print a cost warning.
The CLI raises the episode limits to 120 turns and tool calls unless you pass
`--max-turns` or `--max-tool-calls` yourself.

An OpenAI-compatible endpoint uses `OPENAI_BASE_URL` and `OPENAI_API_KEY`:

```bash
npx benchmark-hundred-step run --provider openai --model "model-id" --lengths 25
```

## How it works

```text
seeded task -> model -> advance(step, prior token) -> deterministic state
                    |-> fault -> retry or rollback -> replay grader -> report
```

Each task represents one of six workflows: ticket pipeline, invoice batch,
inventory reconciliation, employee onboarding, data migration, or scheduling.
The simulator returns an opaque token after every successful step. The next
call must carry that exact token, so steps cannot be guessed, reordered, or
skipped.

Seeded faults interrupt the sequence. A transient fault requires an exact
retry. A rollback fault returns a checkpoint step and token; the agent must
call `rollback` with both before retrying. The grader creates a fresh simulator
and replays only the submitted tool log. It ignores model-authored final state.

## Why it exists

A short tool test can miss errors that appear after dozens of dependent calls.
This package isolates that failure mode. Length changes while the workflow,
fault rules, grader, and public seed stay inspectable.

## Compare

Checked on 2026-10-15.

| Property | benchmark-hundred-step | AgentBench | Ad hoc trace test |
| --- | --- | --- | --- |
| Focus | Dependency survival and recovery | Broad interactive agent ability | One local scenario |
| Public tasks | 24 seeded episodes | Eight environments described by the paper | User-defined |
| Length control | 25, 50, 75, or 100 steps | Environment-specific | User-defined |
| Fault protocol | Transient retry and checkpoint rollback | Environment-specific | User-defined |
| Grading here | Deterministic trace replay | Separate benchmark | Usually manual |
| Offline check | Fixed mock policy | Separate setup | Varies |

This table compares scope, not benchmark quality. See the
[AgentBench paper](https://arxiv.org/abs/2308.03688) for its current design.

## Coverage

| Workflow | Dependency chain | Transient fault | Rollback fault |
| --- | --- | --- | --- |
| Ticket pipeline | Included | Included | Included |
| Invoice batch | Included | Included | Included |
| Inventory reconciliation | Included | Included | Included |
| Employee onboarding | Included | Included | Included |
| Data migration | Included | Included | Included |
| Scheduling | Included | Included | Included |

All 24 entries run through the same credential-free simulator in the E2E gate.
No workflow connects to a production service.

## Common use cases

1. **Model teams:** compare long-horizon reliability at fixed task lengths.
2. **Agent teams:** catch dependency-token and recovery regressions before release.
3. **Tool authors:** inspect failed traces against a deterministic state machine.
4. **Researchers:** regenerate public or held-out task splits from a known seed.

## Features

- **Length slices:** Run one or more of four supported step counts.
- **Fault recovery:** Test exact retries and checkpoint rollback.
- **Replay grading:** Score a saved trace without a provider or model judge.
- **Four surfaces:** Use the SDK, CLI, HTTP API, or MCP server.
- **Share cards:** Render any standard report as a 1200×630 SVG.

## Read the score

Every task receives a score from 0 to 1:

| Component | Weight | Meaning |
| --- | ---: | --- |
| Survival | 60% | Correct steps before the first error left unrecovered |
| Final success | 25% | All steps and required recovery actions completed |
| Recovery rate | 10% | Injected failures resolved correctly |
| Rollback correctness | 5% | Required rollback used the issued checkpoint |

A reason such as `survival=50/75; final=false; recoveries=2/3;
rollback=0/1` exposes the component counts. Each report also retains simulator
state per row. `artifacts/e2e-report.json`, written by the development gate,
includes the survival curve by step.

The report mean is the average task score. Its 95% interval is a seeded
bootstrap interval over tasks, not a claim about all possible workflows.

## Data and provenance

`data/tasks.jsonl` contains 24 generated tasks: six workflows crossed with four
lengths. Failure positions come from a seeded shuffle; each task contains at
least one rollback and one transient fault. Regenerate the public data exactly:

```bash
node scripts/gen-tasks.mjs --seed 20261015 --split public
```

Generate a held-out candidate without overwriting public data:

```bash
node scripts/gen-tasks.mjs --seed 20271015 --split hidden
```

The hidden file is gitignored. Keep it outside the repository and npm package,
then disclose its seed after evaluation. See [the provenance record](data/PROVENANCE.md)
and [task format](docs/task-format.md) for the licence, refresh cadence, and
field definitions.

## Surfaces

### SDK

```ts
import { benchmark, run, score } from "benchmark-hundred-step";
```

`benchmark` exposes the definition and tasks. `run(adapter, options)` returns a
standard `benchmark-core` report. `score(taskId, trace)` replays one trace.

### CLI

Commands are `list`, `show <task>`, `run`, `score <results.json>`, `card
<report.json>`, `provenance`, `index-entry`, `serve`, and `mcp`. Add `--json`
for machine-readable output. `card` writes a 1200×630 SVG.

### Model Context Protocol

```bash
npx benchmark-hundred-step mcp
```

The stdio server provides `list_tasks`, `get_task`, `score_answer`,
`run_benchmark`, and `get_provenance`.

### HTTP API

Import `handler` from `benchmark-hundred-step/api`, or start the local server:

```bash
npx benchmark-hundred-step serve 3000
```

Routes are `GET /health`, `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST
/v1/score`, `GET /v1/provenance`, and `GET /v1/index-entry`. Put authentication
and rate limits in front of a public deployment.

## Limits

- The workflows are compact synthetic abstractions, not replicas of production
  ticketing, accounting, warehouse, identity, database, or calendar systems.
- Public tasks and their failure positions can enter training data. Use a
  separately seeded hidden split for comparisons that matter.
- The component weights are design choices. Report the component counts as well
  as the composite score.
- One seeded trace does not measure variance across prompts or sampling seeds.
- Long episodes can be expensive and may hit provider context, timeout, or tool
  limits. Begin with `--lengths 25`.
- A provider can retain prompts under its own policy. The offline mock makes no
  network requests.

There is no public leaderboard yet. No external model scores have been run or
invented for this release.

## Integration guides

- [Run a model through OpenRouter](#run-a-model)
- [Use the TypeScript SDK](#sdk)
- [Connect through Model Context Protocol](#model-context-protocol)
- [Deploy the self-hosted HTTP handler](#http-api)
- [Read and reproduce the dataset](#data-and-provenance)

## Prior art

[AgentBench](https://arxiv.org/abs/2308.03688) helped establish interactive
environments as a useful way to evaluate agents. This benchmark narrows that
idea to dependency survival and deterministic fault recovery; its task data and
wording were created for this package rather than copied from AgentBench.

## Status

Version 0.1.0 is alpha. Task schemas and score weights may change before 1.0.
Report defects in the [issue tracker](https://github.com/pooriaarab/benchmark-hundred-step/issues).
Public case studies are not yet published.

## Development

```bash
npm ci
npm run ci:local
```

The single E2E gate builds the package, runs every task, challenges the grader
with four trivial policies, calls every CLI command and API route, and invokes
every MCP tool.

## FAQ

### What does benchmark-hundred-step measure?

benchmark-hundred-step measures dependency survival and fault recovery across
25 to 100 tool steps. It does not estimate general model quality.

### Can benchmark-hundred-step run offline?

benchmark-hundred-step runs end to end with the fixed mock policy. That run
needs no key or network access.

### Which providers work?

benchmark-hundred-step supports OpenRouter and OpenAI-compatible chat endpoints
through `benchmark-core`. The mock provider is available for local checks.

### Which workflows are verified?

benchmark-hundred-step verifies all six synthetic workflows in the E2E gate.
It does not connect to real ticketing, accounting, or scheduling services.

### Does benchmark-hundred-step use an LLM judge?

benchmark-hundred-step uses deterministic tool-log replay. Scoring makes no
model call.

### Does benchmark-hundred-step provide a managed service?

benchmark-hundred-step provides a fetch-style handler and a server you run.
It does not provide a managed endpoint.

### How is benchmark-hundred-step different from AgentBench?

benchmark-hundred-step targets one behavior across controlled episode lengths.
AgentBench covers broader agent ability across several environments.

### Can benchmark-hundred-step use a hidden split?

benchmark-hundred-step generates a gitignored hidden candidate with `--split
hidden`. Keep that file outside the published package and disclose its seed
after evaluation.

### Is there a public leaderboard?

benchmark-hundred-step has no public leaderboard yet. This release reports no
external model scores.

## License

[MIT](LICENSE) © Pooria Arab
