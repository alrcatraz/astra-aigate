/**
 * 显式的模型曝光允许/拒绝名单，用于 `/v1/models` 目录。
 *
 * 移植自上游 OmniRoute #11481。与 `hidePaidModels` 的 opt-in 形态保持一致
 * （见 `src/lib/db/settings.ts`）：默认关闭，两个独立的字符串数组
 * （`modelVisibilityDenylist` / `modelVisibilityAllowlist`）。
 *
 * 条目可以是精确的目录 id（`"provider/model"` 或裸 `"model"`），也可以是
 * glob 模式（`*`/`?`）——复用共享的 `globToRegex` 匹配器（`freeModels.ts` 与
 * `modelComboMappings.ts` 已在用），不引入新的匹配逻辑。
 *
 * 本谓词是**唯一收口点**，必须被两处调用（这是 #6512 已经踩过一次的坑：
 * 只在目录侧过滤，仍会从 `auto/*` combo 路由漏出去）：
 *   - `src/app/api/v1/models/catalog.ts`（`/v1/models` 列表本身）
 *   - `open-sse/services/autoCombo/modelExposureFilter.ts`（`auto/*` 候选池镜像）
 *
 * 显式指定（不走 `auto/*`）的 model id 在派发时**永不**被拦截——只过滤目录
 * 广告与候选池成员资格，行为与 `hideAutoCombos` 一致。
 */
import { globToRegex } from "./globPattern";

export interface ModelExposureListSettings {
  modelVisibilityAllowlist?: unknown;
  modelVisibilityDenylist?: unknown;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/**
 * `list` 中是否有条目匹配 `candidates` 之一——先做精确字符串比对（常见情形，
 * 无正则开销），仅当条目真的含通配符时才回退到 glob 匹配。
 */
function listMatchesAny(list: string[], candidates: string[]): boolean {
  return list.some((entry) => {
    if (candidates.includes(entry)) return true;
    if (!/[*?]/.test(entry)) return false;
    let regex: RegExp;
    try {
      regex = globToRegex(entry);
    } catch {
      return false;
    }
    return candidates.some((candidate) => regex.test(candidate));
  });
}

/**
 * 给定运营者的允许/拒绝名单，判断某个 (provider, model) 对是否应曝光。
 *
 * 空名单（默认）永远曝光——opt-in、默认关闭，符合「绝不代替运营者改变默认
 * 行为」的一贯约定。拒绝名单优先（deny 胜过重叠的 allow 条目）；当允许名单
 * 非空时，只有它匹配的条目才能存活。
 */
export function isModelExposureAllowed(
  provider: string,
  modelId: string,
  settings: ModelExposureListSettings | null | undefined
): boolean {
  const denylist = normalizeList(settings?.modelVisibilityDenylist);
  const allowlist = normalizeList(settings?.modelVisibilityAllowlist);
  if (denylist.length === 0 && allowlist.length === 0) return true;

  const candidates = [modelId, `${provider}/${modelId}`];
  if (listMatchesAny(denylist, candidates)) return false;
  if (allowlist.length === 0) return true;
  return listMatchesAny(allowlist, candidates);
}

/** 两个名单是否至少有一项（用于短路：空名单时调用方可完全跳过过滤）。 */
export function hasAnyModelExposureEntries(
  settings: ModelExposureListSettings | null | undefined
): boolean {
  return (
    normalizeList(settings?.modelVisibilityDenylist).length > 0 ||
    normalizeList(settings?.modelVisibilityAllowlist).length > 0
  );
}
