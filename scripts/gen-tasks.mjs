import { mkdir, writeFile } from "node:fs/promises";

const workflows = [
  ["ticket-pipeline", "Triage, assign, resolve, and audit a support-ticket queue"],
  ["invoice-batch", "Validate, approve, post, and reconcile an invoice batch"],
  ["inventory-reconciliation", "Count, compare, adjust, and sign off warehouse inventory"],
  ["onboarding-checklist", "Provision, verify, and hand off a new employee account"],
  ["data-migration", "Extract, transform, load, and validate a data partition"],
  ["scheduling", "Collect constraints, reserve slots, and confirm a service schedule"],
];
const lengths = [25, 50, 75, 100];

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}
const seed = Number(option("--seed", "20261015"));
const split = option("--split", "public");
if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a non-negative integer");
if (!new Set(["public", "hidden"]).has(split)) throw new Error("--split must be public or hidden");

function randomFor(value) {
  let state = value >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
function failuresFor(length, taskSeed) {
  const random = randomFor(taskSeed);
  const candidates = Array.from({ length: length - 6 }, (_, index) => index + 4);
  for (let index = candidates.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
  }
  const count = length === 25 ? 2 : length < 100 ? 3 : 4;
  return candidates.slice(0, count).sort((a, b) => a - b).map((step, index) => ({
    step,
    kind: index === count - 1 ? "rollback" : "transient",
  }));
}

const tasks = workflows.flatMap(([workflow, description], workflowIndex) => lengths.map((length, lengthIndex) => {
  const taskSeed = seed + workflowIndex * 1009 + lengthIndex * 97;
  return {
    id: `${workflow}-${length}`,
    kind: "episode",
    prompt: [
      `${description} through ${length} dependent operations.`,
      "Call advance for each numbered step in order, passing the exact token returned by the previous successful step.",
      "Retry a transient failure. If rollback is required, call rollback with the checkpoint step and token from the error, then retry the failed step.",
      "Stop only after advance reports complete: true. Never guess a token or skip a step.",
    ].join(" "),
    input: { workflow, length, initialToken: `${workflow}:${taskSeed}:start` },
    expected: { completedSteps: length },
    metadata: { seed: taskSeed, split, workflow, length, failures: failuresFor(length, taskSeed) },
  };
}));

const output = split === "public" ? "data/tasks.jsonl" : ".hidden/tasks.jsonl";
await mkdir(split === "public" ? "data" : ".hidden", { recursive: true });
await writeFile(output, `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
console.log(`generated ${tasks.length} ${split} tasks in ${output} with seed ${seed}`);
