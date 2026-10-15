#!/usr/bin/env node
import { createCli } from "benchmark-core";
import { benchmark, withLengths } from "./benchmark.js";

const args = process.argv.slice(2);
const lengthIndex = args.indexOf("--lengths");
let selected = benchmark;
if (lengthIndex !== -1) {
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
      selected = withLengths(lengths);
      args.splice(lengthIndex, 2);
    }
  }
}
if (process.exitCode === undefined) {
  if (args[0] === "run") {
    const chosen = await selected.listTasks();
    if (chosen.some((task) => task.input.length > 25)) {
      console.error("Cost warning: 50-100 step episodes can consume substantial tokens and provider spend.");
    }
    if (!args.includes("--max-turns")) args.push("--max-turns", "120");
    if (!args.includes("--max-tool-calls")) args.push("--max-tool-calls", "120");
  }
  process.exitCode = await createCli(selected, { bin: "benchmark-hundred-step" }).main(args);
}
