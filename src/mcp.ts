import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  MAX_TOOL_LOG_ENTRIES,
  mockAdapter,
  openaiCompatAdapter,
  openrouterAdapter,
  type Benchmark,
  type ModelAdapter,
} from "benchmark-core";
import { benchmark, createBenchmark, runTasks, type WorkflowTask } from "./benchmark.js";

const tools = [
  { name: "list_tasks", description: "List benchmark task ids and prompts.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_task", description: "Get one benchmark task.", inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"], additionalProperties: false } },
  { name: "score_answer", description: "Score a trace with the deterministic benchmark grader.", inputSchema: { type: "object", properties: { taskId: { type: "string" }, submission: { type: "object" }, seed: { type: "number" } }, required: ["taskId", "submission"], additionalProperties: false } },
  {
    name: "run_benchmark",
    description: "Run every task through a model provider with episode limits sized to the task length.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string" },
        provider: { type: "string", enum: ["openrouter", "openai", "mock"] },
        tasksPath: { type: "string" },
      },
      required: ["model"],
      additionalProperties: false,
    },
  },
  { name: "get_provenance", description: "Get benchmark data provenance.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];

const content = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });
const args = (value: unknown) => (value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

function adapter(provider: string, model: string, bench: Benchmark<WorkflowTask>, seed: number): ModelAdapter {
  if (provider === "mock") return mockAdapter({ seed, ...(bench.definition.mockPolicies ? { policies: bench.definition.mockPolicies } : {}) });
  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required to run a benchmark.");
    return openrouterAdapter({ model });
  }
  if (provider === "openai") return openaiCompatAdapter({ model });
  throw new Error("provider must be openrouter, openai, or mock.");
}

export function createMcpServer(bench: Benchmark<WorkflowTask> = benchmark) {
  const server = new Server({ name: bench.definition.id, version: bench.definition.version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const input = args(request.params.arguments);
      if (request.params.name === "list_tasks") return content({ tasks: await bench.listTasks() });
      if (request.params.name === "get_task") {
        if (typeof input.taskId !== "string") return content({ error: "taskId is required." }, true);
        const task = await bench.getTask(input.taskId);
        return task ? content({ task }) : content({ error: "Task not found." }, true);
      }
      if (request.params.name === "score_answer") {
        if (typeof input.taskId !== "string" || !input.submission || typeof input.submission !== "object" || Array.isArray(input.submission)) return content({ error: "taskId and submission are required." }, true);
        const submittedLog = Reflect.get(input.submission, "toolLog");
        if (Array.isArray(submittedLog) && submittedLog.length > MAX_TOOL_LOG_ENTRIES) return content({ error: `toolLog may not exceed ${MAX_TOOL_LOG_ENTRIES} entries.` }, true);
        const task = await bench.getTask(input.taskId);
        return task ? content({ taskId: task.id, ...await bench.score(task, input.submission, typeof input.seed === "number" ? { seed: input.seed } : {}) }) : content({ error: "Task not found." }, true);
      }
      if (request.params.name === "run_benchmark") {
        if (typeof input.model !== "string") return content({ error: "model is required." }, true);
        const provider = typeof input.provider === "string" ? input.provider : "openrouter";
        const selected = typeof input.tasksPath === "string" ? createBenchmark(input.tasksPath) : bench;
        return content(await runTasks(selected, adapter(provider, input.model, selected, 1)));
      }
      if (request.params.name === "get_provenance") return content({ provenance: bench.definition.provenance });
      return content({ error: `Unknown tool: ${request.params.name}` }, true);
    } catch (caught) {
      return content({ error: caught instanceof Error ? caught.message : "Unknown error." }, true);
    }
  });
  return server;
}

export const startMcp = async (bench: Benchmark<WorkflowTask> = benchmark) => {
  await createMcpServer(bench).connect(new StdioServerTransport());
};
