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
const { benchmark } = await import("../dist/index.js");
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
const repeated = Array.from({ length: 100 }, () => ({ name: "advance", args: { step: 1, token: first.input.initialToken }, result: null }));
const badAnswers = {
  empty: {},
  random: { toolLog: [{ name: "advance", args: { step: 87, token: "random" }, result: null }] },
  alwaysYes: { answer: "yes" },
  repeatedCall: { toolLog: repeated },
};
let badAnswerMaxScore = 0;
for (const [name, submission] of Object.entries(badAnswers)) {
  for (const task of tasks) {
    const grade = await benchmark.score(task, submission, { seed: 1 });
    badAnswerMaxScore = Math.max(badAnswerMaxScore, grade.score);
    assert.ok(grade.score < 0.2, `${name} gamed ${task.id} with ${grade.score}`);
  }
}

const run = await cli("run", "--model", "offline", "--provider", "mock", "--json");
assert.match(run.stderr, /Cost warning/);
const report = JSON.parse(run.stdout);
assert.equal(report.rows.length, 24);
assert.ok(report.rows.some((row) => row.score === 1));
assert.ok(report.rows.some((row) => row.score === 0));
const cheap = JSON.parse((await cli("run", "--model", "offline", "--provider", "mock", "--lengths", "25", "--json")).stdout);
assert.equal(cheap.rows.length, 6);
assert.equal((await cli("list", "--json")).stdout.trim().length > 0, true);
assert.match((await cli("show", first.id)).stdout, new RegExp(first.id));
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/mock-report.json", `${JSON.stringify(report)}\n`);
assert.equal(JSON.parse((await cli("score", "artifacts/mock-report.json", "--json")).stdout).rows.length, 24);
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

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "benchmark-hundred-step-e2e", version: "0.1.0" });
await client.connect(transport); let toolNames;
try {
  const available = await client.listTools(); toolNames = available.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_provenance", "get_task", "list_tasks", "run_benchmark", "score_answer"]);
  const calls = [
    ["list_tasks", {}], ["get_task", { taskId: first.id }],
    ["score_answer", { taskId: first.id, submission: goodSubmissions.get(first.id) }],
    ["get_provenance", {}], ["run_benchmark", { model: "offline" }],
  ];
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    if (name === "run_benchmark") assert.equal(result.isError, true); else assert.notEqual(result.isError, true);
  }
} finally { await client.close(); }

const survivalCurve = {};
for (let step = 1; step <= 100; step++) {
  const eligible = report.rows.filter((row) => row.submission?.finalState?.totalSteps >= step);
  if (eligible.length) survivalCurve[step] = eligible.filter((row) => row.submission.finalState.completedSteps >= step).length / eligible.length;
}
const artifact = {
  task_count: report.rows.length,
  scores: report.rows.map((row) => row.score),
  bad_answer_max_score: badAnswerMaxScore,
  survival_curve_by_step: survivalCurve,
  route_status_codes: routes,
  tool_names: toolNames,
};
await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
assert.match(await readFile("data/PROVENANCE.md", "utf8"), /Seeded dependent-workflow state machines/);
console.log(`e2e: ${artifact.task_count} tasks, 4 bad-answer policies, 9 CLI commands, ${Object.keys(routes).length} routes, ${toolNames.length} tools -> all surfaces passed, ok`);
