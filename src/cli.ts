#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  bootstrapCI,
  createCli,
  mockAdapter,
  openaiCompatAdapter,
  openrouterAdapter,
  renderMarkdown,
  type Benchmark,
  type ModelAdapter,
  type RunReport,
} from "benchmark-core";
import {
  benchmark,
  breakdownFor,
  breakdownMarkdown,
  createBenchmark,
  runTasks,
  withLengths,
  type WorkflowTask,
} from "./benchmark.js";
import { startMcp } from "./mcp.js";

const BIN = "benchmark-hundred-step";
const usage = `Usage: ${BIN} <list|show|run|score|card|provenance|index-entry|serve|mcp> [--tasks <file>] [--lengths <list>] [options]`;

class UsageError extends Error {}
function isUsageError(caught: unknown) {
  if (caught instanceof UsageError) return true;
  const code = caught !== null && typeof caught === "object" ? Reflect.get(caught, "code") : undefined;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS");
}

function adapter(provider: string, model: string, bench: Benchmark<WorkflowTask>, seed: number): ModelAdapter {
  if (provider === "mock") return mockAdapter({ seed, ...(bench.definition.mockPolicies ? { policies: bench.definition.mockPolicies } : {}) });
  if (provider === "openrouter") return openrouterAdapter({ model });
  if (provider === "openai") return openaiCompatAdapter({ model });
  throw new UsageError("--provider must be openrouter, openai, or mock.");
}

function splitJson(argv: string[]) {
  const jsonOutput = argv.includes("--json");
  return { jsonOutput, clean: argv.filter((arg) => arg !== "--json") };
}

async function runCommand(bench: Benchmark<WorkflowTask>, argv: string[]) {
  const { jsonOutput, clean } = splitJson(argv);
  const parsed = parseArgs({
    args: clean,
    options: {
      model: { type: "string" }, provider: { type: "string" }, concurrency: { type: "string" },
      timeout: { type: "string" }, retries: { type: "string" }, seed: { type: "string" },
      "max-turns": { type: "string" }, "max-tool-calls": { type: "string" }, budget: { type: "string" },
    },
    strict: true,
  });
  const model = parsed.values.model;
  const provider = parsed.values.provider;
  if (!model || !provider) throw new UsageError("run needs --model and --provider.");
  const chosen = await bench.listTasks();
  if (chosen.some((task) => task.input.length > 25)) {
    console.error("Cost warning: 50-100 step episodes can consume substantial tokens and provider spend.");
  }
  const seed = Number(parsed.values.seed ?? 1);
  const report = await runTasks(bench, adapter(provider, model, bench, seed), {
    ...(parsed.values.concurrency ? { concurrency: Number(parsed.values.concurrency) } : {}),
    ...(parsed.values.timeout ? { timeoutMs: Number(parsed.values.timeout) } : {}),
    ...(parsed.values.retries ? { retries: Number(parsed.values.retries) } : {}),
    seed,
    ...(parsed.values["max-turns"] ? { maxTurns: Number(parsed.values["max-turns"]) } : {}),
    ...(parsed.values["max-tool-calls"] ? { maxToolCalls: Number(parsed.values["max-tool-calls"]) } : {}),
    ...(parsed.values.budget ? { budgetUsd: Number(parsed.values.budget) } : {}),
  });
  console.log(jsonOutput ? JSON.stringify(report) : renderMarkdown(report) + breakdownMarkdown(report.breakdown));
  return report.rows.some((row) => row.error) ? 2 : 0;
}

function reportFile(value: unknown): RunReport {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Array.isArray(Reflect.get(value, "rows"))) {
    throw new UsageError("File is not a run report.");
  }
  return value as RunReport;
}

async function scoreCommand(bench: Benchmark<WorkflowTask>, argv: string[]) {
  const { jsonOutput, clean } = splitJson(argv);
  const file = clean[0];
  if (!file) throw new UsageError("score needs a results JSON file.");
  const original = reportFile(JSON.parse(await readFile(file, "utf8")));
  const tasks = await bench.listTasks();
  const rows = [];
  for (const row of original.rows) {
    const task = await bench.getTask(row.taskId);
    if (!task || row.submission === undefined) throw new UsageError(`Cannot score task ${row.taskId}.`);
    const grade = await bench.score(task, row.submission, { seed: original.seed });
    rows.push({ ...row, score: grade.score, reason: grade.reason });
  }
  const scores = rows.map((row) => row.score);
  const rescored: RunReport = {
    ...original, rows,
    mean: scores.reduce((sum, value) => sum + value, 0) / scores.length,
    confidenceInterval95: bootstrapCI(scores, original.seed),
  };
  const out = { ...rescored, breakdown: breakdownFor(rescored, tasks) };
  console.log(jsonOutput ? JSON.stringify(out) : renderMarkdown(out) + breakdownMarkdown(out.breakdown));
  return 0;
}

const args = process.argv.slice(2);
let selected: Benchmark<WorkflowTask> = benchmark;
const tasksIndex = args.indexOf("--tasks");
if (tasksIndex !== -1) {
  const path = args[tasksIndex + 1];
  if (!path || path.startsWith("--")) {
    console.error("--tasks needs a JSONL task file path.");
    process.exitCode = 1;
  } else {
    selected = createBenchmark(path);
    args.splice(tasksIndex, 2);
  }
}
const lengthIndex = args.indexOf("--lengths");
if (process.exitCode === undefined && lengthIndex !== -1) {
  const raw = args[lengthIndex + 1];
  if (!raw) {
    console.error("--lengths needs a comma-separated list containing 25, 50, 75, or 100.");
    process.exitCode = 1;
  } else {
    const lengths = new Set(raw.split(",").map(Number));
    if ([...lengths].some((length) => ![25, 50, 75, 100].includes(length))) {
      console.error("--lengths accepts only 25, 50, 75, or 100.");
      process.exitCode = 1;
    } else {
      selected = withLengths(lengths, selected);
      args.splice(lengthIndex, 2);
    }
  }
}
if (process.exitCode === undefined) {
  const [command, ...rest] = args;
  try {
    if (command === "run") {
      const providerIndex = rest.indexOf("--provider");
      if (providerIndex !== -1 && rest[providerIndex + 1] === "mock" && !rest.includes("--model")) rest.push("--model", "offline");
      process.exitCode = await runCommand(selected, rest);
    } else if (command === "score") {
      process.exitCode = await scoreCommand(selected, rest);
    } else if (command === "mcp") {
      await startMcp(selected);
      process.exitCode = 0;
    } else {
      process.exitCode = await createCli(selected, { bin: BIN }).main(args);
    }
  } catch (caught) {
    console.error(caught instanceof Error ? caught.message : String(caught));
    if (isUsageError(caught)) console.error(usage);
    process.exitCode = isUsageError(caught) ? 1 : 2;
  }
}
