import { createHandler } from "benchmark-core";
import { benchmark, createBenchmark } from "./benchmark.js";

export const handler = createHandler(benchmark);

/** Handler backed by an alternate JSONL task file, for example a hidden split. */
export const createApiHandler = (tasksPath: string) => createHandler(createBenchmark(tasksPath));
