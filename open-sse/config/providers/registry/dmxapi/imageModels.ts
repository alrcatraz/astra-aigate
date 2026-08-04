/**
 * DMXAPI (www.dmxapi.cn) image-generation model catalog.
 *
 * DMXAPI is a RMB-priced (人民币计价) Chinese multi-modal API aggregator:
 * one key serves chat + image + video + audio across 577 models
 * (`GET /v1/models` with a valid key, 2026-07-31).
 *
 * Verified live on 2026-07-31 (key from `DMXAPI_API_Key`):
 * - `POST https://www.dmxapi.cn/v1/images/generations` with OpenAI format
 *   → 200 for `qwen-image` and `qwen-image-plus` (returns an Aliyun OSS URL)
 * - `z-image-turbo` → 404 on this endpoint (model exists in /v1/models but
 *   does not route through images/generations — deliberately NOT registered)
 *
 * Only the qwen-image family is registered here (same family, same endpoint,
 * same OpenAI-compatible format). Wan/Seedream/Gemini-image/gpt-image models
 * exist in /v1/models but their generation endpoint behaviour is unverified
 * — they belong to the Phase 2.2 multi-capability pass, not this catalogue.
 */

export interface DmxapiImageModelEntry {
  id: string;
  name: string;
}

export const DMXAPI_IMAGE_MODELS: DmxapiImageModelEntry[] = [
  { id: "qwen-image", name: "Qwen Image" },
  { id: "qwen-image-plus", name: "Qwen Image Plus" },
  { id: "qwen-image-2.0", name: "Qwen Image 2.0" },
  { id: "qwen-image-2.0-pro", name: "Qwen Image 2.0 Pro" },
  { id: "qwen-image-max", name: "Qwen Image Max" },
];
