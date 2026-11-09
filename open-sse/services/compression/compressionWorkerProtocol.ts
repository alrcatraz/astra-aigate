import type {
  CompressionConfig,
  CompressionMode,
  CompressionResult,
  CompressionPipelineStep,
} from "./types.ts";
import type { StackedCompressionStep } from "./strategySelector.ts";

/**
 * 在工作线程之间传递的作业选项。
 *
 * 移植自上游 OmniRoute #13154/#13145，但**按本仓库的 options 集裁剪**：
 * 上游的 `ImageTransportFidelity` / `CompressionWireFormat` / `CompressionStage`
 * 三个类型本仓库不存在（它们的引擎层没有对应能力），故不引入；本仓库的
 * `StackOptions` 另有 `bailout` / `circuitBreaker` / `fidelityGate` / `riskGate`
 * / `compressionComboId` / `stepConfig`，其中含函数的字段（如接线后的
 * `onEngineStep`）无法跨线程传递，由 `isStrictlySerializable` 在准入时挡掉，
 * 这些作业自动留在主线程执行。
 */
export interface CompressionWorkerOptions {
  model?: string;
  supportsVision?: boolean | null;
  providerTransport?: "direct" | "aggregator";
  config?: CompressionConfig;
  principalId?: string;
  compressionComboId?: string | null;
  bailout?: Record<string, unknown>;
  circuitBreaker?: Record<string, unknown>;
  fidelityGate?: Record<string, unknown>;
  riskGate?: Record<string, unknown>;
  stepConfig?: Record<string, unknown>;
}

export interface CompressionWorkerJob {
  id: number;
  body: Record<string, unknown>;
  mode: CompressionMode;
  options?: CompressionWorkerOptions;
}

export type CompressionWorkerMessage =
  | { id: number; type: "step"; step: StackedCompressionStep }
  | { id: number; type: "result"; result: CompressionResult }
  | { id: number; type: "error"; error: string };

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Anything that is not a (non-null) object is either a structured-clone-safe primitive
// or an unsupported value (e.g. a non-finite number, a function, a symbol). Isolated
// from `isStrictlySerializable` so the recursive walk below stays flat.
function isClonablePrimitive(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

// Date/Map/Set/RegExp are copied natively by structuredClone (not walked as plain
// objects), so they are always structured-clone-safe regardless of their contents.
const NATIVELY_CLONABLE_CTORS = [Date, Map, Set, RegExp] as const;
function isNativelyClonable(value: object): boolean {
  return NATIVELY_CLONABLE_CTORS.some((ctor) => value instanceof ctor);
}

// `seen` tracks only the current recursion PATH (ancestors), not every node ever visited:
// add before descending, remove after returning. That way a real cycle (a node reachable
// from itself) is still rejected, but two sibling branches that happen to reference the
// SAME non-cyclic sub-object (a false positive with a globally-shared `seen` set) are not.
export function isStrictlySerializable(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return isClonablePrimitive(value);
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.every((entry) => isStrictlySerializable(entry, seen));
    if (isNativelyClonable(value)) return true;
    if (!isPlainObject(value)) return false;
    return Object.values(value).every((entry) => isStrictlySerializable(entry, seen));
  } finally {
    seen.delete(value);
  }
}

/**
 * 同步 worker 实现目前只覆盖这几个纯 CPU 引擎。含其它引擎（例如需要网络或
 * 模型推理的引擎）的 stacked 管线留在主线程，避免在 worker 里静默失效。
 */
const WORKER_STACK_ENGINES = new Set(["caveman", "rtk", "standard"]);

export function isCompressionWorkerEligible(
  body: Record<string, unknown>,
  mode: CompressionMode,
  options?: CompressionWorkerOptions
): boolean {
  if (mode === "ultra") {
    // 启发式 ultra 在超大的 Native Codex /v1/responses 历史上可能吃掉大量 CPU/堆，
    // 隔离到 worker 里跑，避免拖住网关进程。模型/SLM 驱动的 ultra 留在专属异步
    // 路径上，因为同步 worker 实现只跑启发式那一档。
    const modelPath = (options?.config as { ultra?: { modelPath?: string } } | undefined)?.ultra
      ?.modelPath;
    const hasModelPath = typeof modelPath === "string" && modelPath.trim().length > 0;
    const ultraEngine = (options?.config as { ultraEngine?: string } | undefined)?.ultraEngine;
    if (ultraEngine === "slm" || hasModelPath) return false;
    return isStrictlySerializable({ body, mode, ...(options ? { options } : {}) });
  }
  if (mode !== "standard" && mode !== "rtk" && mode !== "stacked") return false;
  if (mode === "stacked") {
    const pipeline = options?.config?.stackedPipeline as
      Array<CompressionPipelineStep | string> | undefined;
    if (!Array.isArray(pipeline) || pipeline.length === 0) return false;
    if (
      pipeline.some((step) => {
        const engine = typeof step === "string" ? step : step.engine;
        return !WORKER_STACK_ENGINES.has(engine);
      })
    ) {
      return false;
    }
  }
  return isStrictlySerializable({ body, mode, ...(options ? { options } : {}) });
}
