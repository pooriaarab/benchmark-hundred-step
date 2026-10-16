#!/usr/bin/env node
import { createCli, type Benchmark } from "benchmark-core";
import { benchmark, createBenchmark, withLengths, type WorkflowTask } from "./benchmark.js";

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
  if (args[0] === "run") {
    const providerIndex = args.indexOf("--provider");
    if (providerIndex !== -1 && args[providerIndex + 1] === "mock" && !args.includes("--model")) args.push("--model", "offline");
    const chosen = await selected.listTasks();
    if (chosen.some((task) => task.input.length > 25)) {
      console.error("Cost warning: 50-100 step episodes can consume substantial tokens and provider spend.");
    }
    if (!args.includes("--max-turns")) args.push("--max-turns", "120");
    if (!args.includes("--max-tool-calls")) args.push("--max-tool-calls", "120");
  }
  process.exitCode = await createCli(selected, { bin: "benchmark-hundred-step" }).main(args);
}
