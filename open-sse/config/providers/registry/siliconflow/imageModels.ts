/**
 * SiliconFlow image-generation model catalog.
 *
 * All API IDs verified against the SiliconFlow model directory
 * (www.siliconflow.com/models, 2026-07-31 — every ID read from the
 * per-model detail page heading, which is the exact `model` string the
 * `/v1/images/generations` API expects).
 *
 * Notable quirks (verified, not inferred):
 * - `FLUX-1.1-pro` uses a HYPHEN (not a dot): `black-forest-labs/FLUX-1.1-pro`
 * - `FLUX-1.1-pro-Ultra` has a capital U: `.../FLUX-1.1-pro-Ultra`
 * - `image_size` is an ASPECT RATIO ("1:1", "3:4", ...), not pixels —
 *   the OpenAI-compatible handler passes `size` through verbatim, so
 *   clients sending OpenAI pixel sizes ("1024x1024") are rejected by
 *   SiliconFlow; supported sizes below list the accepted ratios.
 * - Kolors has been delisted from the SiliconFlow model directory.
 *
 * Edit-capable models (FLUX.1-Kontext-*, FLUX.2-*) accept an optional
 * input image alongside the text prompt (image editing / composition).
 */

export interface SiliconFlowImageModelEntry {
  id: string;
  name: string;
  inputModalities?: string[];
}

export const SILICONFLOW_IMAGE_MODELS: SiliconFlowImageModelEntry[] = [
  { id: "black-forest-labs/FLUX.2-flex", name: "FLUX.2 Flex", inputModalities: ["text", "image"] },
  { id: "black-forest-labs/FLUX.2-pro", name: "FLUX.2 Pro", inputModalities: ["text", "image"] },
  { id: "black-forest-labs/FLUX-1.1-pro", name: "FLUX 1.1 Pro" },
  { id: "black-forest-labs/FLUX-1.1-pro-Ultra", name: "FLUX 1.1 Pro Ultra" },
  {
    id: "black-forest-labs/FLUX.1-Kontext-pro",
    name: "FLUX.1 Kontext Pro",
    inputModalities: ["text", "image"],
  },
  {
    id: "black-forest-labs/FLUX.1-Kontext-max",
    name: "FLUX.1 Kontext Max",
    inputModalities: ["text", "image"],
  },
  {
    id: "black-forest-labs/FLUX.1-Kontext-dev",
    name: "FLUX.1 Kontext Dev",
    inputModalities: ["text", "image"],
  },
  { id: "black-forest-labs/FLUX.1-dev", name: "FLUX.1 Dev" },
  { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell" },
  { id: "Qwen/Qwen-Image", name: "Qwen-Image" },
  { id: "Qwen/Qwen-Image-Edit", name: "Qwen-Image-Edit", inputModalities: ["text", "image"] },
  { id: "Tongyi-MAI/Z-Image-Turbo", name: "Z-Image-Turbo" },
];
