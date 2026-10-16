import { mkdir, writeFile } from "node:fs/promises";

const PUBLIC_SEED = 20261015;
const publicWorkflows = [
  ["ticket-pipeline", "Triage, assign, resolve, and audit a support-ticket queue"],
  ["invoice-batch", "Validate, approve, post, and reconcile an invoice batch"],
  ["inventory-reconciliation", "Count, compare, adjust, and sign off warehouse inventory"],
  ["onboarding-checklist", "Provision, verify, and hand off a new employee account"],
  ["data-migration", "Extract, transform, load, and validate a data partition"],
  ["scheduling", "Collect constraints, reserve slots, and confirm a service schedule"],
];
// Held-out split uses different workflow names and descriptions so prompts differ.
const hiddenWorkflows = [
  ["vendor-onboarding", "Collect documents, verify details, provision access, and sign off a new vendor"],
  ["claims-adjudication", "Open, review, pay, and audit an insurance-claim queue"],
  ["fleet-maintenance", "Inspect, schedule, repair, and release a delivery-vehicle fleet"],
  ["month-end-close", "Gather entries, reconcile balances, approve, and lock a ledger period"],
  ["schema-migration", "Snapshot, transform, apply, and verify a schema change set"],
  ["crew-rostering", "Collect availability, assign shifts, and publish a crew roster"],
];
const promptTemplates = [
  (description, length) => [
    `${description} through ${length} dependent operations.`,
    "Call advance for each numbered step in order, passing the exact token returned by the previous successful step.",
    "Retry a transient failure. If rollback is required, call rollback with the checkpoint step and token from the error, then retry the failed step.",
    "Stop only after advance reports complete: true. Never guess a token or skip a step.",
  ].join(" "),
  (description, length) => [
    `Work the job "${description}" as ${length} sequential dependent operations.`,
    "Each advance call takes the step number and the exact token returned by the previous successful step.",
    "A transient fault clears on an exact retry with the same token. A rollback fault must be acknowledged: call rollback with the checkpoint step and token named in the error, then retry the failed step.",
    "Finish only after the last advance reports complete: true. Tokens cannot be guessed and steps cannot be skipped.",
  ].join(" "),
];
const lengths = [25, 50, 75, 100];

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
const split = option("--split") ?? "public";
const seedOption = option("--seed");
if (!new Set(["public", "hidden"]).has(split)) throw new Error("--split must be public or hidden");
// The hidden split has no committed default seed: pass --seed and keep it unpublished.
if (split === "hidden" && seedOption === undefined) {
  throw new Error("hidden split needs an explicit --seed you keep unpublished (never the public seed)");
}
const seed = Number(seedOption ?? PUBLIC_SEED);
if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a non-negative integer");
if (split === "hidden" && seed === PUBLIC_SEED) throw new Error("hidden split must not reuse the public seed");

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
// Must stay in sync with tokenAfter in src/benchmark.ts.
function tokenAfter(previous, workflow, seed, step) {
  let hash = 2166136261;
  for (const character of `${previous}|${workflow}|${seed}|${step}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `${workflow}:${step}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function failuresFor(length, taskSeed, splitName) {
  const random = randomFor(taskSeed);
  const candidates = Array.from({ length: length - 6 }, (_, index) => index + 4);
  for (let index = candidates.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
  }
  // Hidden counts vary with the seed so fault structure differs from the public split.
  const count = splitName === "hidden"
    ? Math.min(4, 2 + Math.floor(random() * (length / 25)))
    : length === 25 ? 2 : length < 100 ? 3 : 4;
  return candidates.slice(0, count).sort((a, b) => a - b).map((step, index) => ({
    step,
    kind: index === count - 1 ? "rollback" : "transient",
  }));
}

const hidden = split === "hidden";
const workflows = hidden ? hiddenWorkflows : publicWorkflows;
const template = hidden ? promptTemplates[1] : promptTemplates[0];
const cells = workflows.flatMap(([workflow, description], workflowIndex) =>
  lengths.map((length, lengthIndex) => ({ workflow, description, workflowIndex, length, lengthIndex })));
if (hidden) {
  // Seed also drives the order the hidden tasks appear in.
  const random = randomFor(seed);
  for (let index = cells.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cells[index], cells[other]] = [cells[other], cells[index]];
  }
}

const tasks = cells.map(({ workflow, description, workflowIndex, length, lengthIndex }) => {
  const taskSeed = seed + workflowIndex * 1009 + lengthIndex * 97;
  let terminalToken = `${workflow}:${taskSeed}:start`;
  for (let step = 1; step <= length; step++) terminalToken = tokenAfter(terminalToken, workflow, taskSeed, step);
  return {
    id: `${hidden ? "hs-" : ""}${workflow}-${length}`,
    kind: "episode",
    prompt: template(description, length),
    input: { workflow, length, initialToken: `${workflow}:${taskSeed}:start` },
    expected: { completedSteps: length, terminalToken },
    metadata: { seed: taskSeed, split, workflow, length, failures: failuresFor(length, taskSeed, split) },
  };
});

const output = hidden ? ".hidden/tasks.jsonl" : "data/tasks.jsonl";
await mkdir(hidden ? ".hidden" : "data", { recursive: true });
await writeFile(output, `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
console.log(`generated ${tasks.length} ${split} tasks in ${output} with seed ${seed}`);
