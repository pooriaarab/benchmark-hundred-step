import type { ModelAdapter, RunOptions, Trace } from "benchmark-core";
import { benchmark, createBenchmark, runTasks } from "./benchmark.js";

export {
  benchmark,
  createBenchmark,
  withLengths,
  limitsForLength,
  limitsForTasks,
  breakdownFor,
  breakdownMarkdown,
  runTasks,
  WorkflowEnvironment,
} from "./benchmark.js";
export type {
  LengthBreakdown,
  SurvivalPoint,
  WorkflowBreakdown,
  WorkflowReport,
  WorkflowState,
  WorkflowTask,
} from "./benchmark.js";

export type WorkflowRunOptions = RunOptions & {
  /** Path to an alternate JSONL task file, for example a generated hidden split. */
  tasksPath?: string;
};

export const run = (adapter: ModelAdapter, options?: WorkflowRunOptions) => {
  const { tasksPath, ...rest } = options ?? {};
  const selected = tasksPath === undefined ? benchmark : createBenchmark(tasksPath);
  return runTasks(selected, adapter, rest);
};

export async function score(taskId: string, submission: Trace, options?: { tasksPath?: string }) {
  const selected = options?.tasksPath === undefined ? benchmark : createBenchmark(options.tasksPath);
  const task = await selected.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return selected.score(task, submission);
}
