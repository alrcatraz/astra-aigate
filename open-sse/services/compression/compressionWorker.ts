/**
 * 压缩 worker 线程入口。由 `compressionWorkerPool.ts` 起进程，每个作业通过
 * `parentPort` 以结构化克隆消息收发。
 *
 * 移植自上游 OmniRoute #13154。**必须镜像 `runCompression` 的 adapt/restore 步骤**：
 * 同步/进程内 "stacked" 分支会先经 `adaptBodyForCompression`（Responses 的 `input[]`
 * 与 Kiro 的 `conversationState` 信封被压平成 `messages[]`，压缩后再还原）。若 worker
 * 直接对原始 body 调 `applyStackedCompression`，Responses/Kiro 的 body 会在 worker
 * 跑到时才被错误压缩（形状错乱，且 hard-budget 复核告警被静默丢弃）。
 */
import { parentPort } from "node:worker_threads";
import {
  applyCompression,
  applyStackedCompression,
  type StackedCompressionStep,
} from "./strategySelector.ts";
import { adaptBodyForCompression } from "./bodyAdapter.ts";
import type {
  CompressionWorkerJob,
  CompressionWorkerMessage,
} from "./compressionWorkerProtocol.ts";
import type { CompressionResult, CompressionConfig } from "./types.ts";

function runStackedJob(
  job: CompressionWorkerJob,
  onEngineStep: (step: StackedCompressionStep) => void
): CompressionResult {
  const cfg = job.options?.config as CompressionConfig | undefined;
  const preserveToolNames =
    (cfg?.codexResponsesConfig as { preserveToolNames?: string[] } | undefined)
      ?.preserveToolNames ?? [];
  const adapter = adaptBodyForCompression(job.body, preserveToolNames);
  const result = applyStackedCompression(
    adapter.body,
    cfg?.stackedPipeline as Array<Record<string, unknown> | string> | undefined,
    { ...job.options, onEngineStep } as never
  );
  return adapter.adapted ? { ...result, body: adapter.restore(result.body) } : result;
}

if (!parentPort) throw new Error("compressionWorker must run in a worker thread");

parentPort.on("message", (job: CompressionWorkerJob) => {
  try {
    const onEngineStep = (step: StackedCompressionStep) =>
      parentPort.postMessage({
        id: job.id,
        type: "step",
        step,
      } satisfies CompressionWorkerMessage);
    const result =
      job.mode === "stacked"
        ? runStackedJob(job, onEngineStep)
        : applyCompression(job.body, job.mode, job.options);
    parentPort.postMessage({
      id: job.id,
      type: "result",
      result,
    } satisfies CompressionWorkerMessage);
  } catch (error) {
    parentPort.postMessage({
      id: job.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies CompressionWorkerMessage);
  }
});
