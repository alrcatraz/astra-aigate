/**
 * Image Generation Provider Registry
 *
 * Defines providers that support the /v1/images/generations endpoint.
 * Each provider has its own request format and endpoint.
 */

import { LMARENA_DIRECT_IMAGE_MODELS } from "./providers/registry/lmarena/directModels.ts";
import {
  IMAGE_MODEL_ALIASES,
  IMAGE_PROVIDERS,
  resolveImageModelAlias,
  findImageModelConfig,
  resolveAliasImageRequired,
} from "./imageRegistryData.ts";
export { IMAGE_MODEL_ALIASES, IMAGE_PROVIDERS } from "./imageRegistryData.ts";
import type {
  ImageModelEntry,
  ImageProviderConfig,
  ImageModelAliasEntry,
  ImageCatalogModelEntry,
} from "./imageRegistryTypes.ts";
export type {
  ImageModelEntry,
  ImageProviderConfig,
  ImageModelAliasEntry,
  ImageCatalogModelEntry,
} from "./imageRegistryTypes.ts";
import { SEGMIND_IMAGE_PROVIDER } from "./providers/registry/segmind/imageModels.ts";
import { KIE_IMAGE_MODELS } from "./providers/registry/kie/imageModels.ts";
import { FREEPIK_IMAGE_PROVIDER } from "./providers/registry/freepik/index.ts";
import { STABILITY_AI_IMAGE_MODELS } from "./providers/registry/stability-ai/imageModels.ts";
import { GEMINI_IMAGEN_PROVIDER } from "./providers/registry/gemini/imageModels.ts";
import { SILICONFLOW_IMAGE_MODELS } from "./providers/registry/siliconflow/imageModels.ts";
import { SILICONFLOW_CN_IMAGE_MODELS } from "./providers/registry/siliconflow-cn/imageModels.ts";
import { ZAI_IMAGE_MODELS } from "./providers/registry/zai/imageModels.ts";
import { DMXAPI_IMAGE_MODELS } from "./providers/registry/dmxapi/imageModels.ts";

/**
 * Get image provider config by ID
 */
export function getImageProvider(providerId) {
  return IMAGE_PROVIDERS[providerId] || null;
}

/**
 * Parse image model string (format: "provider/model")
 * Returns { provider, model }
 */
export function parseImageModel(modelStr) {
  if (!modelStr) return { provider: null, model: null };

  const directAlias = resolveImageModelAlias(modelStr);
  if (directAlias) {
    return directAlias;
  }

  // Try each provider prefix
  for (const [providerId, config] of Object.entries(IMAGE_PROVIDERS)) {
    if (modelStr.startsWith(providerId + "/")) {
      const model = modelStr.slice(providerId.length + 1);
      const aliased =
        resolveImageModelAlias(`${providerId}/${model}`) || resolveImageModelAlias(model);
      return aliased || { provider: providerId, model };
    }
    // Check alias if available
    if (config.alias && modelStr.startsWith(config.alias + "/")) {
      const model = modelStr.slice(config.alias.length + 1);
      const aliased =
        resolveImageModelAlias(`${providerId}/${model}`) || resolveImageModelAlias(model);
      return aliased || { provider: providerId, model };
    }
  }

  // No provider prefix — try to find the model in every provider
  for (const [providerId, config] of Object.entries(IMAGE_PROVIDERS)) {
    if (config.models.some((m) => m.id === modelStr)) {
      return { provider: providerId, model: modelStr };
    }
  }

  return { provider: null, model: modelStr };
}

/**
 * Get all image models as a flat list
 */
function imageProviderCatalogEntries(
  providerId: string,
  config: ImageProviderConfig
): ImageCatalogModelEntry[] {
  return config.models.map((model) => ({
    id: `${providerId}/${model.id}`,
    name: model.name,
    provider: providerId,
    supportedSizes: config.supportedSizes,
    inputModalities: model.inputModalities || ["text"],
    description: model.description || undefined,
  }));
}

function imageAliasCatalogEntry(
  alias: string,
  target: ImageModelAliasEntry
): ImageCatalogModelEntry | null {
  if (!target.listInCatalog) return null;

  const providerConfig = IMAGE_PROVIDERS[target.provider];
  const modelConfig = findImageModelConfig(target.provider, target.model);
  return {
    id: alias,
    name: target.name || modelConfig?.name || alias,
    provider: target.provider,
    supportedSizes: providerConfig?.supportedSizes || [],
    inputModalities: target.inputModalities || modelConfig?.inputModalities || ["text"],
    description: target.description || modelConfig?.description || undefined,
  };
}

export function getAllImageModels(): ImageCatalogModelEntry[] {
  const providerModels = Object.entries(IMAGE_PROVIDERS).flatMap(([providerId, config]) =>
    imageProviderCatalogEntries(providerId, config)
  );
  const aliasModels = Object.entries(IMAGE_MODEL_ALIASES).flatMap(([alias, target]) => {
    const entry = imageAliasCatalogEntry(alias, target);
    return entry ? [entry] : [];
  });
  return [...providerModels, ...aliasModels];
}

export function getImageModelAliases() {
  return IMAGE_MODEL_ALIASES;
}

/**
 * #6457 — precise provider+modelId membership check against the image registry.
 * Unlike getImageModelEntry() (which also resolves bare aliases and unprefixed
 * ids by scanning every provider), this only answers "is `modelId` registered
 * as an image model under this exact `providerId`?" — used by the chat catalog
 * builder to keep upstream-discovered models (e.g. HuggingFace's live
 * `/v1/models`, which returns image/diffusion models with no modality field)
 * out of the chat listing when they are already known image-only models.
 */
export function isRegisteredImageModel(providerId, modelId) {
  return Boolean(findImageModelConfig(providerId, modelId));
}

export function getImageModelEntry(modelStr) {
  if (!modelStr) return null;

  const alias = IMAGE_MODEL_ALIASES[modelStr];
  if (alias) {
    const modelConfig = findImageModelConfig(alias.provider, alias.model);
    return {
      provider: alias.provider,
      model: alias.model,
      inputModalities: alias.inputModalities || modelConfig?.inputModalities || ["text"],
      imageRequired: resolveAliasImageRequired(alias, modelConfig),
      description: alias.description || modelConfig?.description || undefined,
    };
  }

  const { provider, model } = parseImageModel(modelStr);
  if (!provider || !model) return null;

  const modelConfig = findImageModelConfig(provider, model);
  if (!modelConfig) return null;

  return {
    provider,
    model,
    inputModalities: modelConfig.inputModalities || ["text"],
    imageRequired: modelConfig.imageRequired,
    description: modelConfig.description || undefined,
  };
}

/**
 * An image input is only MANDATORY for edit-only models — those whose modalities
 * are `["image"]` with no `"text"`. Models listing both `["text", "image"]` accept
 * an image but can also run pure text-to-image, so they must NOT be gated on an
 * image input (that gate previously blocked 41 dual-modality t2i models).
 */
export function modalitiesRequireImageInput(inputModalities) {
  const list = Array.isArray(inputModalities) ? inputModalities : ["text"];
  return list.includes("image") && !list.includes("text");
}
