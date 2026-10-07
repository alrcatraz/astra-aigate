/**
 * Provider endpoint / model preset tables for image generation.
 *
 * Extracted from `imageGeneration.ts` so the handler file keeps the request
 * pipeline (base-url resolution, error sanitisation, provider dispatch) while
 * the static tables live next to their siblings.
 */

export const OPENAI_IMAGE_TO_IMAGE_MODELS = new Set([
  "black-forest-labs/FLUX.2-max",
  "black-forest-labs/FLUX.2-pro",
  "black-forest-labs/FLUX.2-flex",
  "black-forest-labs/FLUX.2-dev",
  "black-forest-labs/FLUX.1-Kontext-pro",
  "black-forest-labs/FLUX.1-Kontext-max",
  "black-forest-labs/FLUX.1-Kontext-dev",
  "openai/gpt-image-1.5",
  "Wan-AI/Wan2.6-image",
  "Qwen/Qwen-Image-2.0-Pro",
  "Qwen/Qwen-Image-2.0",
  "Qwen/Qwen-Image-Edit",
  "Qwen/Qwen-Image-Edit-2509",
  "google/flash-image-3.1",
  "google/gemini-3-pro-image",
  "flux-kontext-max",
  "flux-kontext",
  "flux-kontext-pro",
  "qwen-image",
]);

export const IMAGE_ASPECT_RATIO_PATTERN = /^\d+:\d+$/;

export const BFL_MODEL_ENDPOINTS = {
  "flux-2-max": "/v1/flux-2-max",
  "flux-2-pro": "/v1/flux-2-pro",
  "flux-2-flex": "/v1/flux-2-flex",
  "flux-2-klein-9b": "/v1/flux-2-klein-9b",
  "flux-2-klein-4b": "/v1/flux-2-klein-4b",
  "flux-kontext-pro": "/v1/flux-kontext-pro",
  "flux-kontext-max": "/v1/flux-kontext-max",
  "flux-pro-1.1": "/v1/flux-pro-1.1",
  "flux-pro-1.1-ultra": "/v1/flux-pro-1.1-ultra",
  "flux-dev": "/v1/flux-dev",
  "flux-pro": "/v1/flux-pro",
};

export const BFL_EDIT_MODELS = new Set([
  "flux-2-max",
  "flux-2-pro",
  "flux-2-flex",
  "flux-kontext-pro",
  "flux-kontext-max",
]);

export const BFL_FAILURE_STATUSES = new Set([
  "Error",
  "Failed",
  "Content Moderated",
  "Request Moderated",
]);

export const STABILITY_GENERATION_ENDPOINTS = {
  "sd3.5-large": "/v2beta/stable-image/generate/sd3",
  "sd3.5-large-turbo": "/v2beta/stable-image/generate/sd3",
  "sd3.5-medium": "/v2beta/stable-image/generate/sd3",
  "sd3.5-flash": "/v2beta/stable-image/generate/sd3",
  "stable-image-ultra": "/v2beta/stable-image/generate/ultra",
  "stable-image-core": "/v2beta/stable-image/generate/core",
};

export const STABILITY_EDIT_ENDPOINTS = {
  inpaint: "/v2beta/stable-image/edit/inpaint",
  outpaint: "/v2beta/stable-image/edit/outpaint",
  erase: "/v2beta/stable-image/edit/erase",
  "search-and-replace": "/v2beta/stable-image/edit/search-and-replace",
  "search-and-recolor": "/v2beta/stable-image/edit/search-and-recolor",
  "remove-background": "/v2beta/stable-image/edit/remove-background",
  "replace-background-and-relight": "/v2beta/stable-image/edit/replace-background-and-relight",
  fast: "/v2beta/stable-image/upscale/fast",
  conservative: "/v2beta/stable-image/upscale/conservative",
  creative: "/v2beta/stable-image/upscale/creative",
  sketch: "/v2beta/stable-image/control/sketch",
  structure: "/v2beta/stable-image/control/structure",
  style: "/v2beta/stable-image/control/style",
  "style-transfer": "/v2beta/stable-image/control/style-transfer",
};

export const STABILITY_CONTROL_MODELS = new Set(["sketch", "structure", "style", "style-transfer"]);

export const FAL_PRESET_SIZES = {
  "1024x1024": "square_hd",
  "512x512": "square",
  "1792x1024": "landscape_16_9",
  "1024x1792": "portrait_16_9",
  "1024x768": "landscape_4_3",
  "768x1024": "portrait_4_3",
  "1536x1024": "landscape_3_2",
  "1024x1536": "portrait_3_2",
  "576x1024": "portrait_16_9",
  "1024x576": "landscape_16_9",
};
