/**
 * `auto/*` combo 候选池镜像：把 `/v1/models` 的显式模型曝光允许/拒绝名单
 * 应用到每一个候选池。
 *
 * 移植自上游 OmniRoute #11481。
 *
 * `src/app/api/v1/models/catalog.ts` 会隐藏被拒绝的模型（设了允许名单时收敛到
 * 该名单），但 `auto/*` combo 是**独立**构建候选池的——这正是 #6512 已经为
 * `hidePaidModels` 修过一次的坑（PR #6495 把付费模型从 `GET /v1/models` 隐藏了，
 * 但 `auto/*` 仍可能路由过去，在请求时才 402/403）。这里把 `catalog.ts` 使用的
 * 同一个谓词应用到每个虚拟 auto-combo 候选池。
 *
 * 保持为纯函数、依赖轻量，以便不 seed 数据库就能单测（与 `paidModelFilter.ts`
 * 的做法一致）。
 */
import {
  isModelExposureAllowed,
  hasAnyModelExposureEntries,
  type ModelExposureListSettings,
} from "@/shared/utils/modelExposureList";

interface ExposureFilterCandidate {
  provider: string;
  model: string;
}

/**
 * 按运营者的模型曝光允许/拒绝名单过滤候选池；两个名单都为空时原样返回
 * （identity —— 默认的、opt-in 关闭的路径）。若允许名单把池清空了，由调用方
 * 既有的「优雅空池」路径兜底，与 opt-in 意图一致。
 */
export function filterModelExposureCandidates<T extends ExposureFilterCandidate>(
  pool: T[],
  settings: ModelExposureListSettings | null | undefined
): T[] {
  if (!hasAnyModelExposureEntries(settings)) return pool;
  return pool.filter((candidate) =>
    isModelExposureAllowed(candidate.provider, candidate.model, settings)
  );
}
