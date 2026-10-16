import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const execFile = promisify(execFileCallback);
const cli = (...args) => execFile(process.execPath, ["dist/cli.js", ...args], { maxBuffer: 10_000_000 });

await execFile("npm", ["run", "build"]);
const { benchmark, createBenchmark, WorkflowEnvironment } = await import("../dist/index.js");
const tasks = await benchmark.listTasks();
assert.equal(tasks.length, 24);

const goodSubmissions = new Map();
for (const task of tasks) {
  const turns = benchmark.definition.mockPolicies.good(task);
  const toolLog = turns.flatMap((turn) => (turn.toolCalls ?? []).map((call) => ({ ...call, result: null })));
  const submission = { toolLog };
  goodSubmissions.set(task.id, submission);
  const grade = await benchmark.score(task, submission, { seed: 1 });
  assert.equal(grade.score, 1, `${task.id}: ${grade.reason}`);
}
const first = tasks[0];

// Stopping one step short must stay well below a complete run.
for (const task of tasks) {
  const short = { toolLog: goodSubmissions.get(task.id).toolLog.slice(0, -1) };
  const grade = await benchmark.score(task, short, { seed: 1 });
  assert.ok(grade.score < 0.75, `early stop scored ${grade.score} on ${task.id}`);
}

// The strategy from the review: never track tokens, just probe advance and
// reuse whatever the error message leaks. After the fix it stalls at zero.
function errorReaderSubmission(task) {
  const env = new WorkflowEnvironment();
  env.reset(task);
  const toolLog = [];
  for (let step = 1; step <= task.input.length; step++) {
    let guess = "guess";
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = env.callTool("advance", { step, token: guess });
      toolLog.push({ name: "advance", args: { step, token: guess }, result: result.result, error: result.error });
      const leaked = /:([0-9a-f]{8})\b/.exec(result.error?.message ?? "");
      if (!leaked) break;
      guess = `${task.input.workflow}:${step}:${leaked[1]}`;
    }
  }
  return { toolLog };
}

const badAnswers = {
  empty: {},
  refuse: { answer: "I cannot help with that." },
  sameCall: (task) => ({
    toolLog: Array.from({ length: task.input.length + 8 }, () => ({ name: "advance", args: { step: 1, token: task.input.initialToken }, result: null })),
  }),
  errorReader: errorReaderSubmission,
};
let badAnswerMaxScore = 0;
for (const constant of ["", "0", "yes", "done", "complete"]) {
  badAnswers[`constant:${JSON.stringify(constant)}`] = { answer: constant };
}
for (const [name, policy] of Object.entries(badAnswers)) {
  for (const task of tasks) {
    const submission = typeof policy === "function" ? policy(task) : policy;
    const grade = await benchmark.score(task, submission, { seed: 1 });
    badAnswerMaxScore = Math.max(badAnswerMaxScore, grade.score);
    assert.ok(grade.score < 0.2, `${name} gamed ${task.id} with ${grade.score}`);
  }
}

// Environment-level regression checks for the review findings.
{
  const env = new WorkflowEnvironment();
  env.reset(first);
  const mismatch = env.callTool("advance", { step: 1, token: "probe" });
  assert.equal(mismatch.error?.code, "DEPENDENCY_MISMATCH");
  assert.ok(!mismatch.error.message.includes(":"), "DEPENDENCY_MISMATCH must not name the token");

  // A wrong probe must not mask the scheduled fault.
  const failure = first.metadata.failures[0];
  const env2 = new WorkflowEnvironment();
  env2.reset(first);
  let token = first.input.initialToken;
  for (let step = 1; step < failure.step; step++) {
    const result = env2.callTool("advance", { step, token });
    token = result.result.token;
  }
  env2.callTool("advance", { step: failure.step, token: "probe" });
  const injected = env2.callTool("advance", { step: failure.step, token });
  assert.ok(injected.error?.code === "TRANSIENT" || injected.error?.code === "ROLLBACK_REQUIRED",
    `scheduled fault was skipped: ${JSON.stringify(injected)}`);

  // Steps past the end are rejected and cannot void a finished episode.
  const env3 = new WorkflowEnvironment();
  env3.reset(first);
  for (const call of benchmark.definition.mockPolicies.good(first)[0].toolCalls) env3.callTool(call.name, call.args);
  const past = env3.callTool("advance", { step: first.input.length + 1, token: "x" });
  assert.equal(past.error?.code, "WORKFLOW_COMPLETE");
  assert.equal(env3.state().finalSuccess, true);
  assert.equal(env3.state().completedSteps, first.input.length);
}

// Hidden split: private seed, distinct ids/prompts, public traces do not transfer.
// 991807 is an e2e fixture seed, never an evaluation seed.
await execFile(process.execPath, ["scripts/gen-tasks.mjs", "--seed", "991807", "--split", "hidden"]);
const hidden = createBenchmark(".hidden/tasks.jsonl");
const hiddenTasks = await hidden.listTasks();
assert.equal(hiddenTasks.length, 24);
const publicIds = new Set(tasks.map((task) => task.id));
const publicPrompts = new Set(tasks.map((task) => task.prompt));
for (const [index, task] of hiddenTasks.entries()) {
  assert.ok(task.id.startsWith("hs-"), `hidden id ${task.id} lacks prefix`);
  assert.ok(!publicIds.has(task.id));
  assert.ok(!publicPrompts.has(task.prompt), `hidden prompt duplicates public text`);
  const reference = { toolLog: goodSubmissions.get(tasks[index].id).toolLog };
  const grade = await benchmark.score(task, reference, { seed: 1 });
  assert.ok(grade.score < 1, `public trace scored ${grade.score} on hidden ${task.id}`);
}
const packed = JSON.parse((await execFile("npm", ["pack", "--dry-run", "--json"], { maxBuffer: 10_000_000 })).stdout);
assert.equal(packed[0].files.filter((file) => file.path.startsWith(".hidden") || file.path.includes("hidden")).length, 0, "hidden split leaked into the package");

const run = await cli("run", "--model", "offline", "--provider", "mock", "--json");
assert.match(run.stderr, /Cost warning/);
const report = JSON.parse(run.stdout);
assert.equal(report.rows.length, 24);
assert.ok(report.rows.some((row) => row.score === 1));
assert.ok(report.rows.some((row) => row.score === 0));
assert.equal(Object.keys(report.breakdown.byLength).length, 4);
assert.equal(report.breakdown.byLength["25"].tasks, 6);
assert.ok(report.breakdown.survivalCurve.length >= 100);
assert.equal(report.breakdown.survivalCurve[0].step, 1);
assert.equal(report.breakdown.survivalCurve.at(-1).step, 100);
const cheap = JSON.parse((await cli("run", "--provider", "mock", "--lengths", "25", "--json")).stdout);
assert.equal(cheap.rows.length, 6);
assert.deepEqual(Object.keys(cheap.breakdown.byLength), ["25"]);
assert.equal(cheap.breakdown.survivalCurve.at(-1).step, 25);
const hiddenRun = JSON.parse((await cli("run", "--provider", "mock", "--tasks", ".hidden/tasks.jsonl", "--lengths", "25", "--json")).stdout);
assert.equal(hiddenRun.rows.length, 6);
assert.ok(hiddenRun.rows.every((row) => row.taskId.startsWith("hs-")));
assert.equal((await cli("list", "--json")).stdout.trim().length > 0, true);
assert.match((await cli("show", first.id)).stdout, new RegExp(first.id));
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/mock-report.json", `${JSON.stringify(report)}\n`);
const rescored = JSON.parse((await cli("score", "artifacts/mock-report.json", "--json")).stdout);
assert.equal(rescored.rows.length, 24);
assert.ok(rescored.breakdown.survivalCurve.length >= 100);
await cli("card", "artifacts/mock-report.json", "artifacts/share-card.svg");
assert.match(await readFile("artifacts/share-card.svg", "utf8"), /<svg/);
assert.match((await cli("provenance")).stdout, /Seeded dependent-workflow/);
assert.equal(JSON.parse((await cli("index-entry", "--json")).stdout).task_count, 24);

const probe = createNetServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address(); assert.ok(address && typeof address === "object");
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["dist/cli.js", "serve", String(address.port)], { stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${address.port}`; const routes = {};
async function get(path) {
  const response = await fetch(`${base}${path}`); routes[`GET ${path}`] = response.status;
  return { response, value: await response.json() };
}
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { await get("/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  assert.equal((await get("/health")).response.status, 200);
  assert.equal((await get("/v1/tasks")).value.tasks.length, 24);
  assert.equal((await get(`/v1/tasks/${first.id}`)).value.task.id, first.id);
  const score = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: first.id, submission: goodSubmissions.get(first.id) }) });
  routes["POST /v1/score"] = score.status; assert.equal(score.status, 200); assert.equal((await score.json()).score, 1);
  assert.equal((await get("/v1/provenance")).response.status, 200);
  assert.equal((await get("/v1/index-entry")).value.task_count, 24);
} finally { if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); } }

// The API serves a split file too.
const hiddenServer = spawn(process.execPath, ["dist/cli.js", "serve", "--tasks", ".hidden/tasks.jsonl", "--host", "127.0.0.1", String(address.port)], { stdio: ["ignore", "pipe", "pipe"] });
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { await get("/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  const hiddenList = (await get("/v1/tasks")).value.tasks;
  assert.equal(hiddenList.length, 24);
  assert.ok(hiddenList.every((task) => task.id.startsWith("hs-")));
} finally { if (hiddenServer.exitCode === null) { hiddenServer.kill("SIGTERM"); await once(hiddenServer, "exit"); } }

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "benchmark-hundred-step-e2e", version: "0.2.0" });
await client.connect(transport); let toolNames;
try {
  const available = await client.listTools(); toolNames = available.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_provenance", "get_task", "list_tasks", "run_benchmark", "score_answer"]);
  const calls = [
    ["list_tasks", {}], ["get_task", { taskId: first.id }],
    ["score_answer", { taskId: first.id, submission: goodSubmissions.get(first.id) }],
    ["get_provenance", {}],
  ];
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true);
  }
  const noKey = await client.callTool({ name: "run_benchmark", arguments: { model: "provider/model" } });
  assert.equal(noKey.isError, true);
  const mockRun = await client.callTool({ name: "run_benchmark", arguments: { model: "offline", provider: "mock" } });
  assert.notEqual(mockRun.isError, true);
  const mcpReport = JSON.parse(mockRun.content[0].text);
  assert.equal(mcpReport.rows.length, 24);
  assert.ok(mcpReport.breakdown.survivalCurve.length >= 100);
  assert.ok(mcpReport.rows.some((row) => row.score === 1), "MCP run limits must fit the longest episode");
} finally { await client.close(); }

const artifact = {
  task_count: report.rows.length,
  scores: report.rows.map((row) => row.score),
  bad_answer_max_score: badAnswerMaxScore,
  survival_curve_by_step: Object.fromEntries(report.breakdown.survivalCurve.map((point) => [point.step, point.rate])),
  by_length: report.breakdown.byLength,
  route_status_codes: routes,
  tool_names: toolNames,
};
await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
assert.match(await readFile("data/PROVENANCE.md", "utf8"), /Seeded dependent-workflow state machines/);
console.log(`e2e: ${artifact.task_count} tasks, ${Object.keys(badAnswers).length} bad-answer policies, hidden split verified, ${Object.keys(routes).length} routes, ${toolNames.length} tools -> all surfaces passed, ok`);
