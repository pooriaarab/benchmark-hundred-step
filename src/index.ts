import { run as runBenchmark, type ModelAdapter, type RunOptions, type Trace } from "benchmark-core";
import { benchmark, createBenchmark } from "./benchmark.js";

export { benchmark, createBenchmark, withLengths, WorkflowEnvironment } from "./benchmark.js";
export type { WorkflowState, WorkflowTask } from "./benchmark.js";

export type WorkflowRunOptions = RunOptions & {
  /** Path to an alternate JSONL task file, for example a generated hidden split. */
  tasksPath?: string;
};

export const run = (adapter: ModelAdapter, options?: WorkflowRunOptions) => {
  const { tasksPath, ...rest } = options ?? {};
  const selected = tasksPath === undefined ? benchmark : createBenchmark(tasksPath);
  return runBenchmark(selected, adapter, rest);
};

export async function score(taskId: string, submission: Trace, options?: { tasksPath?: string }) {
  const selected = options?.tasksPath === undefined ? benchmark : createBenchmark(options.tasksPath);
  const task = await selected.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return selected.score(task, submission);
}
