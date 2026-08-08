import {
  PROVIDER_ID_TO_ALIAS,
  PROVIDER_MODELS,
} from "@omniroute/open-sse/config/providerModels.ts";
import { parseModel, resolveCanonicalProviderModel } from "@omniroute/open-sse/services/model.ts";
import {
  MODEL_SPECS,
  getAuthoritativeContextWindow,
  getAuthoritativeProviderContextWindow,
  getModelSpec,
  type ModelSpec,
} from "@/shared/constants/modelSpecs";
import { getSyncedCapability } from "@/lib/modelsDevSync";
import { MODELS_DEV_PROVIDER_MAP, type ModelCapabilityEntry } from "@/lib/modelsDevSync/transform";
import { getModelContextOverride } from "@/lib/db/modelContextOverrides";
import { getModelCapabilityOverride } from "@/lib/db/modelCapabilityOverrides";
import { isVisionModelId } from "@/shared/constants/visionModels";
import { getUnsupportedParams } from "@omniroute/open-sse/config/providerRegistry.ts";
import {
  getLearnedThinkingCap,
  GEMINI_FALLBACK_THINKING_CAP,
} from "@omniroute/open-sse/services/learnedThinkingCaps.ts";

const TOOL_CALLING_UNSUPPORTED_PATTERNS: string[] = [
  // Specialty / non-chat surfaces must never inherit optimistic tool defaults (#8016)
  "whisper",
  "tts-1",
  "gpt-4o-mini-tts",
  "omni-moderation",
  "moderation",
  "eleven_multilingual",
  "eleven_turbo",
  "seedance",
  "/veo",
  "veo-",
  "rerank",
  "embedding",
  "dall-e",
  "flux-",
  "stable-diffusion",
];
const REASONING_UNSUPPORTED_PATTERNS = [
  "antigravity/claude-sonnet-4-6",
  "antigravity/claude-sonnet-4-5",
  "antigravity/claude-sonnet-4",
  // Non-Claude antigravity models don't support thinking params (#1361)
  "antigravity/gemini-",
  "antigravity/gpt-oss-",
  "antigravity/gemini-3",
  "antigravity/tab_",
  // Specialty / non-chat surfaces (#8016)
  "whisper",
  "tts-1",
  "gpt-4o-mini-tts",
  "omni-moderation",
  "moderation",
  "eleven_multilingual",
  "eleven_turbo",
  "seedance",
  "/veo",
  "veo-",
  "rerank",
  "embedding",
  "dall-e",
  "flux-",
  "stable-diffusion",
];

/** Catalog/API surface types that are not chat completions. */
const NON_CHAT_SURFACE_TYPES = new Set([
  "audio",
  "video",
  "image",
  "moderation",
  "rerank",
  "embedding",
  "music",
]);

export function isNonChatCatalogSurface(type: unknown): boolean {
  return typeof type === "string" && NON_CHAT_SURFACE_TYPES.has(type);
}

const MAX_TOKENS_UNSUPPORTED_PATTERNS = [
  "o1-preview",
  "o1-mini",
  "o1",
  "o3-mini",
  "o3",
  "gpt-5.4",
  "gpt-5.5",
];

type CapabilityInput =
  | string
  | {
      provider?: string | null;
      model?: string | null;
    };

type SyncedCapabilities = Awaited<ReturnType<typeof getSyncedCapability>>;

export interface ResolvedModelCapabilities {
  provider: string | null;
  model: string | null;
  rawModel: string | null;
  toolCalling: boolean;
  reasoning: boolean;
  supportsThinking: boolean | null;
  supportsTools: boolean | null;
  supportsVision: boolean | null;
  supportsMaxTokens: boolean;
  attachment: boolean | null;
  structuredOutput: boolean | null;
  temperature: boolean | null;
  contextWindow: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  defaultThinkingBudget: number;
  thinkingBudgetCap: number | null;
  thinkingOverhead: number | null;
  adaptiveMaxTokens: number | null;
  family: string | null;
  status: string | null;
  openWeights: boolean | null;
  knowledgeCutoff: string | null;
  releaseDate: string | null;
  lastUpdated: string | null;
  modalitiesInput: string[];
  modalitiesOutput: string[];
  interleavedField: string | null;
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function parseModalities(value: string | null | undefined): Promise<string[]> {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
  } catch {
    return [];
  }
}

async function getRegistryModel(providerIdOrAlias: string | null, modelId: string | null) {
  if (!providerIdOrAlias || !modelId) return null;
  const providerAlias = PROVIDER_ID_TO_ALIAS[providerIdOrAlias] || providerIdOrAlias;
  const models = PROVIDER_MODELS[providerAlias];
  if (!Array.isArray(models)) return null;
  return models.find((model) => model?.id === modelId) || null;
}

async function resolveCapabilityInput(input: CapabilityInput) {
  if (typeof input === "string") {
    const parsed = parseModel(input);
    const rawModel = toNonEmptyString(parsed.model);
    if (parsed.provider) {
      const canonical = await resolveCanonicalProviderModel(parsed.provider, rawModel);
      return {
        provider: canonical.provider,
        model: toNonEmptyString(canonical.model),
        rawModel,
        lookupKey: input,
      };
    }

    return {
      provider: null,
      model: rawModel,
      rawModel,
      lookupKey: input,
    };
  }

  const rawProvider = toNonEmptyString(input.provider);
  const rawModel = toNonEmptyString(input.model);
  if (rawProvider) {
    const canonical = await resolveCanonicalProviderModel(rawProvider, rawModel);
    return {
      provider: canonical.provider,
      model: toNonEmptyString(canonical.model),
      rawModel,
      lookupKey: rawModel ? `${canonical.provider}/${rawModel}` : canonical.provider,
    };
  }

  return {
    provider: null,
    model: rawModel,
    rawModel,
    lookupKey: rawModel || "",
  };
}

async function heuristicToolCalling(modelStr: string): Promise<boolean> {
  const normalized = String(modelStr || "").toLowerCase();
  if (!normalized) return false;
  const blocked = TOOL_CALLING_UNSUPPORTED_PATTERNS.some((pattern) => {
    if (normalized === pattern) return true;
    if (normalized.endsWith(`/${pattern}`)) return true;
    return normalized.includes(pattern);
  });
  return !blocked;
}

async function heuristicReasoning(modelStr: string): Promise<boolean> {
  const normalized = String(modelStr || "").toLowerCase();
  if (!normalized) return true;
  const blocked = REASONING_UNSUPPORTED_PATTERNS.some(
    (pattern) =>
      normalized === pattern || normalized.endsWith(`/${pattern}`) || normalized.includes(pattern)
  );
  return !blocked;
}

async function heuristicMaxTokens(modelStr: string): Promise<boolean> {
  const normalized = String(modelStr || "").toLowerCase();
  if (!normalized) return true;
  const blocked = MAX_TOKENS_UNSUPPORTED_PATTERNS.some(
    (pattern) =>
      normalized === pattern || normalized.endsWith(`/${pattern}`) || normalized.includes(pattern)
  );
  return !blocked;
}

/** Last path segment of a path-shaped model id (`cline-pass/kimi-k3` → `kimi-k3`). */
async function leafModelId(modelId: string | null | undefined): Promise<string | null> {
  if (!modelId || !modelId.includes("/")) return null;
  const leaf = modelId.split("/").filter(Boolean).pop() ?? null;
  return leaf && leaf !== modelId ? leaf : null;
}

async function getStaticSpec(
  modelId: string | null,
  rawModel: string | null
): Promise<ModelSpec | undefined> {
  if (modelId) {
    const byCanonical = await getModelSpec(modelId);
    if (byCanonical) return byCanonical;
  }
  if (rawModel && rawModel !== modelId) {
    return getModelSpec(rawModel);
  }
  return undefined;
}

/**
 * #8032: vision-only leaf fallback for path-shaped routed ids.
 *
 * Must NOT live in getStaticSpec() — that helper also feeds supportsTools /
 * supportsThinking / contextWindow / maxOutputTokens. A shared leaf lookup
 * incorrectly promotes e.g. aihorde/deepseek/deepseek-v4-flash to the real
 * DeepSeek V4 Flash tool-calling spec (#8212 regression).
 */
async function getVisionStaticSpec(
  modelId: string | null,
  rawModel: string | null
): Promise<ModelSpec | undefined> {
  const direct = await getStaticSpec(modelId, rawModel);
  if (direct) return direct;
  for (const candidate of [modelId, rawModel]) {
    const leaf = await leafModelId(candidate);
    if (!leaf) continue;
    const byLeaf = await getModelSpec(leaf);
    if (byLeaf) return byLeaf;
  }
  return undefined;
}

async function getAuthoritativeStaticContextWindow(
  provider: string | null,
  modelId: string | null,
  rawModel: string | null
): Promise<number | null> {
  for (const candidate of [modelId, rawModel]) {
    const providerContextWindow = await getAuthoritativeProviderContextWindow(provider, candidate);
    if (typeof providerContextWindow === "number") return providerContextWindow;
  }
  for (const candidate of [modelId, rawModel]) {
    const contextWindow = await getAuthoritativeContextWindow(candidate);
    if (typeof contextWindow === "number") return contextWindow;
  }
  return null;
}

async function getStaticSpecCanonicalModelId(modelId: string | null, rawModel: string | null) {
  const candidates = [modelId, rawModel].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
  );
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    for (const [canonical, spec] of Object.entries(MODEL_SPECS)) {
      if (canonical === "__default__") continue;
      if (canonical.toLowerCase() === lower) return canonical;
      if (spec.aliases?.some((alias) => alias.toLowerCase() === lower)) return canonical;
    }
  }
  return null;
}

/**
 * Strip a trailing `-latest` alias suffix from a model id (#4073). Returns the
 * short id (`pixtral-12b-latest` → `pixtral-12b`) or `null` when there is no
 * `-latest` suffix to drop. Used only as a last-resort synced-lookup fallback.
 */
async function stripLatestAlias(modelId: string | null): Promise<string | null> {
  if (!modelId) return null;
  const stripped = modelId.replace(/-latest$/i, "");
  return stripped && stripped !== modelId ? stripped : null;
}

async function reverseModelsDevProviders(provider: string): Promise<string[]> {
  // models.dev may store capabilities under a different AI Gate provider id
  // that also maps from the same upstream models.dev provider. Build reverse
  // candidates from MODELS_DEV_PROVIDER_MAP (e.g. openai ↔ cx).
  //
  // MODELS_DEV_PROVIDER_MAP's RHS is inconsistent: most providers list their
  // canonical id directly, but the OAuth CLI providers (codex/claude) only
  // list their alias (cx/cc), never the canonical id. Also probe the
  // provider's alias so a canonical id like "codex"/"claude" still matches
  // the map entries keyed only by "cx"/"cc" (#8429).
  const out = new Set<string>();
  const providerAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  for (const [modelsDevId, omniIds] of Object.entries(MODELS_DEV_PROVIDER_MAP)) {
    if (
      omniIds.includes(provider) ||
      omniIds.includes(providerAlias) ||
      modelsDevId === provider ||
      modelsDevId === providerAlias
    ) {
      out.add(modelsDevId);
      for (const id of omniIds) out.add(id);
    }
  }
  return [...out];
}

async function getSyncedCapabilityForResolved(
  provider: string | null,
  model: string | null,
  rawModel: string | null
): Promise<ModelCapabilityEntry | null> {
  if (!provider || !model) return null;

  const modelCandidates = Array.from(
    new Set(
      [model, rawModel, await getStaticSpecCanonicalModelId(model, rawModel)].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    )
  );
  const candidateValues: string[] = [];
  for (const candidate of modelCandidates) {
    const values = [candidate];
    const stripped = await stripLatestAlias(candidate);
    if (stripped) values.push(stripped);
    const leaf = await leafModelId(candidate);
    if (leaf) values.push(leaf);
    // models.dev often stores OpenAI-family specialty models as qualified
    // ids under another mapped provider, e.g. vercel + "openai/whisper-1".
    if (!candidate.includes("/")) {
      values.push(`${provider}/${candidate}`);
    }
    candidateValues.push(...values);
  }
  const uniqueModelCandidates = Array.from(new Set(candidateValues));

  // Include common host providers that re-publish OpenAI specialty models under
  // qualified ids (observed: vercel/openai/whisper-1, vercel/openai/tts-1).
  const providerCandidates = Array.from(
    new Set([provider, ...(await reverseModelsDevProviders(provider)), "vercel"])
  );

  for (const prov of providerCandidates) {
    for (const mid of uniqueModelCandidates) {
      const found = await getSyncedCapability(prov, mid);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Last-resort vision fallback in resolveVisionCapability when there is no
 * synced/registry/spec capability data (e.g. Mistral Pixtral, which ships no
 * models.dev `attachment` flag and no registry `supportsVision`). Delegates to
 * the single shared source (`@/shared/constants/visionModels`, #4072) so routing,
 * the `/v1/models` listing and lite compression can never disagree on whether a
 * model is vision-capable. The list is intentionally conservative — a false
 * positive would let an image request route to a text-only model.
 */
export async function modelIdLikelyVision(modelId: string | null | undefined): Promise<boolean> {
  return isVisionModelId(modelId);
}

/**
 * Models that upstream catalogs (notably models.dev) mislabel as vision-capable but
 * are TEXT-ONLY per the vendor's own docs. Listed here so a wrong synced
 * `attachment:true` cannot route an image request to a blind model (the #4071 failure
 * mode). Keep this list tiny and doc-backed.
 *
 * Xiaomi MiMo: only `mimo-v2.5` and `mimo-v2-omni` accept images; the `*-pro` chat
 * models are text-only (mimo.mi.com .../image-understanding; hermes-agent#18884).
 * Anchored to the full id (`$`) and tolerant of a `provider/` prefix so `mimo-v2.5-pro`
 * never matches the multimodal `mimo-v2.5`, and `mimo-v2-pro` never matches `mimo-v2-omni`.
 */
const KNOWN_TEXT_ONLY_DESPITE_SYNC: readonly RegExp[] = [
  /(?:^|\/)mimo-v2\.5-pro$/i,
  /(?:^|\/)mimo-v2-pro$/i,
];

async function isKnownTextOnlyDespiteSync(modelId: string | null | undefined): Promise<boolean> {
  if (!modelId) return false;
  const id = String(modelId);
  return KNOWN_TEXT_ONLY_DESPITE_SYNC.some((pattern) => pattern.test(id));
}

/** True when a modality list declares image and/or video input/output. */
async function modalitiesDeclareVision(modalities: readonly string[]): Promise<boolean> {
  return modalities.some((entry) => {
    const lower = String(entry).toLowerCase();
    return lower.includes("image") || lower.includes("video");
  });
}

async function resolveVisionCapability(
  spec: ModelSpec | undefined,
  registryModel: { supportsVision?: boolean } | null,
  synced: SyncedCapabilities,
  modalitiesInput: string[],
  modalitiesOutput: string[],
  modelId?: string
): Promise<boolean | null> {
  const allModalities = [...modalitiesInput, ...modalitiesOutput].map((entry) =>
    String(entry).toLowerCase()
  );

  // Hard override FIRST: a wrong synced `attachment:true` (or image modality) must not
  // win for models the vendor documents as text-only. Beats every branch below so an
  // image request can never be routed to a blind model (#4071).
  if (await isKnownTextOnlyDespiteSync(modelId)) return false;

  if (typeof synced?.attachment === "boolean") {
    // #8250: models.dev sometimes ships attachment=false alongside image/video
    // modalities (observed for Kimi K3). Prefer the richer modality signal over
    // the contradictory false flag so supportsVision / attachment / modalities
    // can be reconciled to a single vision-capable verdict.
    if (synced.attachment === false && (await modalitiesDeclareVision(allModalities))) {
      return true;
    }
    // #8032: attachment=false without modalities must not beat authoritative
    // registry/spec vision for path-shaped custom/routed ids (e.g. Cline Pass
    // `cp/cline-pass/kimi-k3` → MODEL_SPECS["kimi-k3"].supportsVision).
    if (synced.attachment === false) {
      if (registryModel?.supportsVision === true) return true;
      if (spec?.supportsVision === true) return true;
      return false;
    }
    return synced.attachment;
  }

  if (allModalities.some((entry) => entry.includes("image"))) {
    return true;
  }

  if (allModalities.length > 0) {
    return false;
  }

  if (typeof registryModel?.supportsVision === "boolean") return registryModel.supportsVision;
  if (typeof spec?.supportsVision === "boolean") return spec.supportsVision;

  // Last resort: no capability data at all. Positively confirm known multimodal
  // families by model id so image requests can be routed to them; everything
  // else stays `null` (unknown).
  if (await modelIdLikelyVision(modelId)) return true;

  return null;
}

/**
 * Issue #6524: an operator-set `max_token` capability override (see
 * `src/lib/db/modelCapabilityOverrides.ts`) is the manual escape hatch for a
 * wrong/stale synced `limit_output` value (e.g. a provider's models.dev catalog
 * row reporting `limit_output` equal to `limit_context`). It already won over the
 * synced value in `getResolvedModelCapabilities().maxOutputTokens` — this helper
 * makes `getExplicitModelOutputCap()` (used by the reasoning-token-buffer clamp)
 * consult the same override so both read paths agree.
 */
async function getMaxTokenCapabilityOverride(resolved: {
  provider: string | null;
  model: string | null;
  rawModel: string | null;
}): Promise<number | null> {
  return (
    getModelCapabilityOverride(resolved.provider, resolved.model, "max_token") ??
    (resolved.rawModel && resolved.rawModel !== resolved.model
      ? getModelCapabilityOverride(resolved.provider, resolved.rawModel, "max_token")
      : null)
  );
}

export async function getExplicitModelOutputCap(input: CapabilityInput): Promise<number | null> {
  const resolved = await resolveCapabilityInput(input);
  const maxTokenOverride = await getMaxTokenCapabilityOverride(resolved);
  if (maxTokenOverride !== null) return maxTokenOverride;

  const synced = await getSyncedCapabilityForResolved(
    resolved.provider,
    resolved.model,
    resolved.rawModel
  );
  if (synced && typeof synced.limit_output === "number") return synced.limit_output;

  const registryModel = await getRegistryModel(resolved.provider, resolved.model);
  if (typeof registryModel?.maxOutputTokens === "number") return registryModel.maxOutputTokens;

  const spec = await getStaticSpec(resolved.model, resolved.rawModel);
  return spec?.maxOutputTokens ?? null;
}

export async function getResolvedModelCapabilities(
  input: CapabilityInput
): Promise<ResolvedModelCapabilities> {
  const cacheKey = capabilityKey(input);
  if (cacheKey) {
    const cached = resolvedCapabilityCache.get(cacheKey);
    if (cached) return cached;
  }
  const resolved = await resolveCapabilityInput(input);
  const spec = await getStaticSpec(resolved.model, resolved.rawModel);
  const registryModel = await getRegistryModel(resolved.provider, resolved.model);
  const synced = await getSyncedCapabilityForResolved(
    resolved.provider,
    resolved.model,
    resolved.rawModel
  );

  const modalitiesInput = await parseModalities(synced?.modalities_input);
  const modalitiesOutput = await parseModalities(synced?.modalities_output);
  const lookupKey =
    (await toNonEmptyString(
      resolved.provider && resolved.model
        ? `${resolved.provider}/${resolved.model}`
        : resolved.model || resolved.rawModel || resolved.lookupKey
    )) || "";
  const reasoningDenied = !(await heuristicReasoning(lookupKey));

  // Provider-level fallback: a live-discovered model (passthroughModels
  // providers like AI Horde) has no per-model registry entry, synced
  // capability, or static spec — every source above resolves to null, so
  // toolCalling would otherwise fall through to heuristicToolCalling's
  // optimistic default (true). Reuse the same unsupportedParams signal the
  // request-time strip already relies on: if the provider declares "tools"
  // unsupported for every model it serves, that's authoritative here too.
  const providerDeniesTools =
    resolved.provider && resolved.model
      ? getUnsupportedParams(resolved.provider, resolved.model).includes("tools")
      : false;

  const supportsTools =
    (await synced?.tool_call) ??
    (typeof registryModel?.toolCalling === "boolean" ? registryModel.toolCalling : null) ??
    (typeof spec?.supportsTools === "boolean" ? spec.supportsTools : null) ??
    (providerDeniesTools ? false : null);

  const supportsThinking = reasoningDenied
    ? false
    : (synced?.reasoning ??
      (typeof registryModel?.supportsReasoning === "boolean"
        ? registryModel.supportsReasoning
        : null) ??
      (typeof spec?.supportsThinking === "boolean" ? spec.supportsThinking : null));

  const authoritativeContextWindow = await getAuthoritativeStaticContextWindow(
    resolved.provider,
    resolved.model,
    resolved.rawModel
  );
  const contextWindow =
    (await authoritativeContextWindow) ??
    synced?.limit_context ??
    (typeof registryModel?.contextLength === "number" ? registryModel.contextLength : null) ??
    spec?.contextWindow ??
    null;

  const maxTokenOverride = await getMaxTokenCapabilityOverride(resolved);

  // Vision consults leaf static metadata for path-shaped ids; other capability
  // fields keep using the non-leaf `spec` from getStaticSpec() above.
  const visionSpec = await getVisionStaticSpec(resolved.model, resolved.rawModel);

  const supportsVision = await resolveVisionCapability(
    visionSpec,
    registryModel,
    synced,
    modalitiesInput,
    modalitiesOutput,
    lookupKey
  );

  // #8250: when resolve promoted vision over a contradictory attachment=false,
  // expose attachment=true so catalog / Vision Bridge / clients see one verdict.
  let attachment = synced?.attachment ?? null;
  if (supportsVision === true && attachment === false) {
    attachment = true;
  }

  const result: ResolvedModelCapabilities = {
    provider: resolved.provider,
    model: resolved.model,
    rawModel: resolved.rawModel,
    toolCalling: supportsTools ?? (await heuristicToolCalling(lookupKey)),
    reasoning: supportsThinking ?? (await heuristicReasoning(lookupKey)),
    supportsThinking,
    supportsTools,
    supportsVision,
    supportsMaxTokens: await heuristicMaxTokens(lookupKey),
    attachment,
    structuredOutput: synced?.structured_output ?? null,
    temperature: synced?.temperature ?? null,
    contextWindow,
    maxInputTokens:
      (typeof registryModel?.maxInputTokens === "number" ? registryModel.maxInputTokens : null) ??
      authoritativeContextWindow ??
      synced?.limit_input ??
      contextWindow,
    maxOutputTokens:
      maxTokenOverride ??
      synced?.limit_output ??
      (typeof registryModel?.maxOutputTokens === "number" ? registryModel.maxOutputTokens : null) ??
      spec?.maxOutputTokens ??
      null,
    defaultThinkingBudget: spec?.defaultThinkingBudget ?? 0,
    thinkingBudgetCap: spec?.thinkingBudgetCap ?? null,
    thinkingOverhead: spec?.thinkingOverhead ?? null,
    adaptiveMaxTokens: spec?.adaptiveMaxTokens ?? null,
    family: synced?.family ?? null,
    status: synced?.status ?? null,
    openWeights: synced?.open_weights ?? null,
    knowledgeCutoff: synced?.knowledge_cutoff ?? null,
    releaseDate: synced?.release_date ?? null,
    lastUpdated: synced?.last_updated ?? null,
    modalitiesInput,
    modalitiesOutput,
    interleavedField:
      synced?.interleaved_field ??
      (typeof registryModel?.interleavedField === "string" ? registryModel.interleavedField : null),
  };
  if (cacheKey) {
    resolvedCapabilityCache.set(cacheKey, result);
  }
  return result;
}

export async function supportsToolCalling(input: CapabilityInput): Promise<boolean> {
  if (typeof input === "string" && !String(input || "").trim()) return false;
  return (await getResolvedModelCapabilities(input)).toolCalling;
}

export async function supportsReasoning(input: CapabilityInput): Promise<boolean> {
  if (typeof input === "string" && !String(input || "").trim()) return true;
  return (await getResolvedModelCapabilities(input)).reasoning;
}

export async function supportsMaxTokens(input: CapabilityInput): Promise<boolean> {
  if (typeof input === "string" && !String(input || "").trim()) return true;
  return (await getResolvedModelCapabilities(input)).supportsMaxTokens;
}

export async function capMaxOutputTokens(
  input: CapabilityInput,
  requested?: number
): Promise<number | null> {
  const cap = (await getResolvedModelCapabilities(input)).maxOutputTokens;
  const hasRequested = typeof requested === "number" && Number.isFinite(requested);
  if (cap === null) return hasRequested ? requested : null;
  return hasRequested ? Math.min(requested, cap) : cap;
}

export async function getDefaultThinkingBudget(input: CapabilityInput): Promise<number> {
  return (await getResolvedModelCapabilities(input)).defaultThinkingBudget;
}

/**
 * Clamp a requested thinking budget to the model's real ceiling.
 *
 * Resolution order (lowest wins):
 *  1. Registry cap (MODEL_SPECS.thinkingBudgetCap) — authoritative when present.
 *  2. Learned cap — a lower ceiling previously discovered via an upstream 400
 *     ("thinking_budget must be in the range ...") recorded by the executor
 *     (open-sse/services/learnedThinkingCaps.ts). In-memory, per provider+model.
 *  3. Gemini-family fallback — when the registry has no cap but the model id
 *     contains "gemini" (any provider: many providers host Gemini models), clamp
 *     to GEMINI_FALLBACK_THINKING_CAP (32768, the known pro-tier cap) instead of
 *     letting an xhigh budget (131072) sail through to a 400. Registered flash
 *     models already carry their explicit 24576 cap via rule 1, so this only
 *     fires for unregistered Gemini ids.
 */
export async function capThinkingBudget(input: CapabilityInput, budget: number): Promise<number> {
  const resolved = await getResolvedModelCapabilities(input);
  let cap = resolved.thinkingBudgetCap;

  const modelId = (await resolved.model) ?? resolved.rawModel ?? "";
  const modelLower = modelId.toLowerCase();
  // Learned-cap lookup needs a concrete provider key (the executor records under
  // `this.provider`). When the input is a bare Gemini id, `resolved.provider` is
  // null — but bare Gemini ids always route to the native Gemini provider, so
  // default to "gemini". Without this a cap learned via the executor would be
  // invisible to bare-model callers. Provider-qualified inputs keep their own
  // provider, preserving per-provider independence.
  const providerForLearned =
    (await resolved.provider) ?? (modelLower.includes("gemini") ? "gemini" : null);

  const learned = await getLearnedThinkingCap(providerForLearned, modelId);
  if (learned !== null) {
    cap = cap === null ? learned : Math.min(cap, learned);
  }

  if (cap === null && modelLower.includes("gemini")) {
    cap = GEMINI_FALLBACK_THINKING_CAP;
  }

  return Math.min(budget, cap ?? budget);
}

export async function getModelContextLimit(
  providerOrInput: CapabilityInput,
  modelId?: string
): Promise<number | null> {
  const resolved =
    typeof providerOrInput === "string" && modelId !== undefined
      ? await getResolvedModelCapabilities({ provider: providerOrInput, model: modelId })
      : await getResolvedModelCapabilities(providerOrInput);
  // Feature 5004: a persisted override (operator-set or auto-discovered) wins over the
  // static catalog / models.dev sync. `getResolvedModelCapabilities` stays override-free
  // so the reconciler can compare the catalog value against provider-declared windows.
  const override = getModelContextOverride(resolved.provider, resolved.model);
  return override ?? resolved.contextWindow;
}

// ── Synchronous capability accessors ─────────────────────────────────────────
// `translateRequest` (open-sse/translator/index.ts) is a synchronous choke point
// every outbound chat request passes through, but `getResolvedModelCapabilities`
// / `supportsReasoning` are async (they await DB/registry lookups). A sync caller
// that forgets to await them reads a Promise (and `.interleavedField` etc. become
// undefined / a Promise is passed where a boolean is expected). These cache-backed
// synchronous accessors let the sync hot path read a previously-resolved result
// with no behavioural change: `getResolvedModelCapabilities` writes back to the
// same cache, and the sync variant falls back to null (triggering an async warm)
// on the very first call of a fresh process.
const resolvedCapabilityCache = new Map<string, ResolvedModelCapabilities>();

function capabilityKey(input: CapabilityInput): string {
  if (typeof input === "string") return input.trim() || "";
  const p = toNonEmptyString(input?.provider);
  const m = toNonEmptyString(input?.model);
  return p ? `${p}/${m ?? ""}` : (m ?? "");
}

export function getResolvedModelCapabilitiesSync(
  input: CapabilityInput
): ResolvedModelCapabilities | null {
  const key = capabilityKey(input);
  if (key) {
    const cached = resolvedCapabilityCache.get(key);
    if (cached) return cached;
    void getResolvedModelCapabilities(input).catch(() => {});
  }
  return null;
}

export function supportsReasoningSync(input: CapabilityInput): boolean | null {
  return getResolvedModelCapabilitiesSync(input)?.reasoning ?? null;
}
