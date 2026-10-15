import { readFile } from "node:fs/promises";
import {
  defineBenchmark,
  replay,
  type Benchmark,
  type Environment,
  type JsonValue,
  type Task,
  type ToolResult,
  type Trace,
} from "benchmark-core";

type FailureKind = "transient" | "rollback";
type Failure = { step: number; kind: FailureKind };
type WorkflowInput = { workflow: string; length: number; initialToken: string };
type WorkflowMetadata = {
  seed: number;
  split: string;
  workflow: string;
  length: number;
  failures: Failure[];
};
export type WorkflowTask = Task & {
  kind: "episode";
  input: WorkflowInput;
  metadata: WorkflowMetadata;
};
type Pending = Failure & { token: string; rollbackDone: boolean; injected: boolean };
export type WorkflowState = {
  completedSteps: number;
  totalSteps: number;
  finalSuccess: boolean;
  recoveries: number;
  expectedRecoveries: number;
  rollbackCorrect: number;
  requiredRollbacks: number;
  unresolvedStep: number | null;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isWorkflowTask(value: unknown): value is WorkflowTask {
  if (!object(value) || value.kind !== "episode" || !object(value.input) || !object(value.metadata)) return false;
  const failures = value.metadata.failures;
  return typeof value.id === "string" && typeof value.prompt === "string" &&
    typeof value.input.workflow === "string" && Number.isInteger(value.input.length) &&
    typeof value.input.initialToken === "string" && Array.isArray(failures) &&
    failures.every((failure) => object(failure) && Number.isInteger(failure.step) &&
      (failure.kind === "transient" || failure.kind === "rollback"));
}
async function loadTasks(): Promise<WorkflowTask[]> {
  const text = await readFile(new URL("../data/tasks.jsonl", import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => {
    const task: unknown = JSON.parse(line);
    if (!isWorkflowTask(task)) throw new Error("Invalid workflow task data.");
    return task;
  });
}

function tokenAfter(previous: string, workflow: string, seed: number, step: number): string {
  let hash = 2166136261;
  for (const character of `${previous}|${workflow}|${seed}|${step}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `${workflow}:${step}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function error(code: string, message: string): ToolResult {
  return { result: null, error: { code, message } };
}

export class WorkflowEnvironment implements Environment<WorkflowTask> {
  #task?: WorkflowTask;
  #completed = 0;
  #token = "";
  #pending: Pending | undefined;
  #injected = new Set<number>();
  #recoveries = 0;
  #rollbackCorrect = 0;

  reset(task: WorkflowTask) {
    this.#task = task;
    this.#completed = 0;
    this.#token = task.input.initialToken;
    this.#pending = undefined;
    this.#injected.clear();
    this.#recoveries = 0;
    this.#rollbackCorrect = 0;
    return {
      system: `Complete all ${task.input.length} steps. The initial dependency token is ${this.#token}. Follow tool errors exactly.`,
      tools: [
        {
          name: "advance",
          description: "Complete the next numbered workflow step using the previous successful step's exact token.",
          parameters: { type: "object" as const, properties: { step: { type: "integer" }, token: { type: "string" } }, required: ["step", "token"], additionalProperties: false },
        },
        {
          name: "rollback",
          description: "Acknowledge a rollback-required error using its exact checkpoint step and token.",
          parameters: { type: "object" as const, properties: { checkpointStep: { type: "integer" }, token: { type: "string" } }, required: ["checkpointStep", "token"], additionalProperties: false },
        },
      ],
    };
  }

  callTool(name: string, args: Record<string, JsonValue>): ToolResult {
    const task = this.#task;
    if (!task) return error("NOT_RESET", "Reset the environment before calling tools.");
    if (name === "rollback") return this.#rollback(args);
    if (name !== "advance") return error("UNKNOWN_TOOL", `Unknown tool: ${name}`);
    const expectedStep = this.#completed + 1;
    if (args.step !== expectedStep || args.token !== this.#token) {
      this.#pending ??= { step: expectedStep, kind: "transient", token: this.#token, rollbackDone: true, injected: false };
      return error("DEPENDENCY_MISMATCH", `Expected step ${expectedStep} with token ${this.#token}.`);
    }
    if (this.#pending) {
      if (this.#pending.kind === "rollback" && !this.#pending.rollbackDone) {
        return error("ROLLBACK_REQUIRED", `Call rollback at checkpoint ${this.#completed} with token ${this.#token}.`);
      }
      if (this.#pending.injected) this.#recoveries++;
      this.#pending = undefined;
      return this.#completeStep(task, expectedStep);
    }
    const failure = task.metadata.failures.find((item) => item.step === expectedStep);
    if (failure && !this.#injected.has(expectedStep)) {
      this.#injected.add(expectedStep);
      this.#pending = { ...failure, token: this.#token, rollbackDone: false, injected: true };
      const message = failure.kind === "rollback"
        ? `Call rollback at checkpoint ${this.#completed} with token ${this.#token}.`
        : `Transient fault at step ${expectedStep}; retry with the same token.`;
      return error(failure.kind === "rollback" ? "ROLLBACK_REQUIRED" : "TRANSIENT", message);
    }
    return this.#completeStep(task, expectedStep);
  }

  #rollback(args: Record<string, JsonValue>): ToolResult {
    if (!this.#pending || this.#pending.kind !== "rollback" || this.#pending.rollbackDone) {
      return error("ROLLBACK_NOT_REQUIRED", "No rollback is currently required.");
    }
    if (args.checkpointStep !== this.#completed || args.token !== this.#token) {
      return error("BAD_CHECKPOINT", `Expected checkpoint ${this.#completed} with token ${this.#token}.`);
    }
    this.#pending.rollbackDone = true;
    this.#rollbackCorrect++;
    return { result: { rolledBack: true, retryStep: this.#completed + 1, token: this.#token } };
  }

  #completeStep(task: WorkflowTask, step: number): ToolResult {
    this.#token = tokenAfter(this.#token, task.input.workflow, task.metadata.seed, step);
    this.#completed = step;
    return { result: { step, token: this.#token, complete: this.done() } };
  }

  state(): WorkflowState {
    const task = this.#task;
    const totalSteps = task?.input.length ?? 0;
    const requiredRollbacks = task?.metadata.failures.filter((failure) => failure.kind === "rollback").length ?? 0;
    return {
      completedSteps: this.#completed,
      totalSteps,
      finalSuccess: this.#completed === totalSteps && !this.#pending,
      recoveries: this.#recoveries,
      expectedRecoveries: task?.metadata.failures.length ?? 0,
      rollbackCorrect: this.#rollbackCorrect,
      requiredRollbacks,
      unresolvedStep: this.#pending?.step ?? null,
    };
  }
  done() { return this.state().finalSuccess; }
}

function scriptedCalls(task: WorkflowTask) {
  let token = task.input.initialToken;
  const calls: Array<{ name: string; args: Record<string, JsonValue> }> = [];
  for (let step = 1; step <= task.input.length; step++) {
    const failure = task.metadata.failures.find((item) => item.step === step);
    if (failure) {
      calls.push({ name: "advance", args: { step, token } });
      if (failure.kind === "rollback") calls.push({ name: "rollback", args: { checkpointStep: step - 1, token } });
    }
    calls.push({ name: "advance", args: { step, token } });
    token = tokenAfter(token, task.input.workflow, task.metadata.seed, step);
  }
  return calls;
}

export const benchmark = defineBenchmark<WorkflowTask>({
  id: "benchmark-hundred-step",
  name: "Hundred Step",
  tagline: "Reliability across 25 to 100 dependent steps.",
  tags: ["helpful"],
  category: "long-horizon",
  whatItMeasures: "Whether an agent preserves dependencies and recovers correctly across 25, 50, 75, and 100 workflow steps.",
  version: "0.1.0",
  status: "alpha",
  loadTasks,
  async grade(task, submission: Trace, context) {
    const state = await replay(new WorkflowEnvironment(), task, submission.toolLog ?? [], context.seed) as WorkflowState;
    if (state.completedSteps === 0) return { score: 0, reason: `survival=0/${state.totalSteps}; no valid progress`, details: state };
    const survivalSteps = state.unresolvedStep === null ? state.completedSteps : Math.min(state.completedSteps, state.unresolvedStep - 1);
    const survival = survivalSteps / state.totalSteps;
    const recoveryRate = state.expectedRecoveries === 0 ? 1 : state.recoveries / state.expectedRecoveries;
    const rollbackRate = state.requiredRollbacks === 0 ? 1 : state.rollbackCorrect / state.requiredRollbacks;
    const score = 0.6 * survival + 0.25 * Number(state.finalSuccess) + 0.1 * recoveryRate + 0.05 * rollbackRate;
    return {
      score: Math.max(0, Math.min(1, score)),
      reason: `survival=${survivalSteps}/${state.totalSteps}; final=${state.finalSuccess}; recoveries=${state.recoveries}/${state.expectedRecoveries}; rollback=${state.rollbackCorrect}/${state.requiredRollbacks}`,
      details: { ...state, survival },
    };
  },
  environment: () => new WorkflowEnvironment(),
  mockPolicies: {
    good: (task) => [{ toolCalls: scriptedCalls(task) }],
    bad: () => [{ content: "yes" }],
  },
  provenance: [{
    name: "Seeded dependent-workflow state machines",
    kind: "synthetic",
    url: "https://github.com/pooriaarab/benchmark-hundred-step/blob/main/scripts/gen-tasks.mjs",
    licence: "MIT",
    howToGet: "Run `node scripts/gen-tasks.mjs --seed 20261015 --split public` from the repository root.",
    retrievedAt: "2026-10-15T00:00:00.000Z",
    contaminationNotes: "The 24 public tasks use seed 20261015. For final comparisons, generate seed 20271015 with `--split hidden`, keep the resulting file out of the repository and npm package, and disclose the seed after evaluation.",
    refresh: "Regenerate annually or after simulator changes, review the JSONL diff, and publish a versioned release.",
  }],
  gradingMethod: "Deterministic tool-log replay combining survival (60%), final success (25%), injected-failure recovery (10%), and rollback correctness (5%).",
});

export function withLengths(lengths: ReadonlySet<number>): Benchmark<WorkflowTask> {
  return {
    definition: benchmark.definition,
    async listTasks() { return (await benchmark.listTasks()).filter((task) => lengths.has(task.input.length)); },
    async getTask(id) {
      const task = await benchmark.getTask(id);
      return task && lengths.has(task.input.length) ? task : undefined;
    },
    score: (task, submission, context) => benchmark.score(task, submission, context),
  };
}
