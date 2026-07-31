/**
 * SiliconFlow CN (www.siliconflow.cn / api.siliconflow.cn) image-generation
 * model catalog — RMB-priced mainland-China site.
 *
 * All API IDs verified against the CN model directory on 2026-07-31 by
 * scrolling the full "生图" (text-to-image) filter list with camofox.
 *
 * CRITICAL: the CN catalogue DIFFERS from the international site
 * (api.siliconflow.com):
 * - FLUX family (black-forest-labs/*, 9 models) does NOT exist on the CN
 *   site (search for "FLUX" and "black-forest" returns nothing).
 * - CN-exclusive models: Tongyi-MAI/Z-Image, baidu/ERNIE-Image-Turbo,
 *   Qwen/Qwen-Image-Edit-2509 (date-suffixed edit variant), Kwai-Kolors/Kolors
 *   (delisted from the international site).
 * - Shared: Qwen/Qwen-Image, Qwen/Qwen-Image-Edit, Tongyi-MAI/Z-Image-Turbo.
 *
 * The international catalogue lives in ../siliconflow/imageModels.ts.
 * Register both providers (siliconflow / siliconflow-cn) with the API base
 * URL matching the key the user configures.
 */

export interface SiliconFlowCnImageModelEntry {
  id: string;
  name: string;
  inputModalities?: string[];
}

export const SILICONFLOW_CN_IMAGE_MODELS: SiliconFlowCnImageModelEntry[] = [
  { id: "Qwen/Qwen-Image", name: "Qwen-Image" },
  { id: "Qwen/Qwen-Image-Edit", name: "Qwen-Image-Edit", inputModalities: ["text", "image"] },
  {
    id: "Qwen/Qwen-Image-Edit-2509",
    name: "Qwen-Image-Edit 2509",
    inputModalities: ["text", "image"],
  },
  { id: "Tongyi-MAI/Z-Image-Turbo", name: "Z-Image-Turbo" },
  { id: "Tongyi-MAI/Z-Image", name: "Z-Image" },
  { id: "baidu/ERNIE-Image-Turbo", name: "ERNIE-Image-Turbo" },
  { id: "Kwai-Kolors/Kolors", name: "Kolors" },
];
