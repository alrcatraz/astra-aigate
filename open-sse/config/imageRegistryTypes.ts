/**
 * Image-registry shapes (model entries, provider config, alias entries),
 * extracted from imageRegistry.ts.
 */

export interface ImageModelEntry {
  id: string;
  name: string;
  inputModalities?: string[];
  // See STABILITY_AI_IMAGE_MODELS for why this exists: some models accept "text"
  // but mechanically require an image regardless.
  imageRequired?: boolean;
  description?: string;
  isMarket?: boolean;
}

export interface ImageProviderConfig {
  id: string;
  baseUrl: string;
  fallbackUrl?: string;
  proUrl?: string;
  statusUrl?: string;
  alias?: string;
  authType: string;
  authHeader: string;
  format: string;
  models: ImageModelEntry[];
  supportedSizes: string[];
}

export interface ImageModelAliasEntry {
  provider: string;
  model: string;
  name: string;
  listInCatalog: boolean;
  inputModalities?: string[];
  imageRequired?: boolean;
  description?: string;
}

export interface ImageCatalogModelEntry {
  id: string;
  name: string;
  provider: string;
  supportedSizes: string[];
  inputModalities: string[];
  description?: string;
}
