/**
 * Zhipu/Z.ai image-generation model catalog.
 *
 * Endpoint verified live on 2026-07-31 with the user's GLM_API_KEY:
 * `POST https://api.z.ai/api/paas/v4/images/generations` returns 200 with
 * OpenAI-format `data[].url` for all three models below. `cogview-4-flash`
 * and `cogview-2` return 400 (do not exist on this endpoint).
 *
 * Note: `GET /v1/models` on z.ai does NOT list image models — the chat
 * model list (glm-4.5 … glm-5.2) is all that appears. The image registry
 * entry is therefore the only place CogView models are visible.
 *
 * The z.ai images endpoint accepts OpenAI pixel sizes ("1024x1024").
 */

export interface ZaiImageModelEntry {
  id: string;
  name: string;
}

export const ZAI_IMAGE_MODELS: ZaiImageModelEntry[] = [
  { id: "cogview-4", name: "CogView-4" },
  { id: "cogview-3", name: "CogView-3" },
  { id: "cogview-3-flash", name: "CogView-3 Flash" },
];
