import { REGISTRY } from "./providers/index.ts";

/**
 * Option-B registry link (PLAN §2.4): media-registry entries (embedding/
 * rerank/audio) that serve an existing chat provider link back to it via a
 * typed `providerId`, and the auth fields are FORCED to match the linked
 * provider's definition at compile time — a media entry can never drift from
 * its provider (e.g. "apikey"+"bearer" vs provider's "x-api-key").
 *
 * Usage on a media entry:
 *   "siliconflow-cn": { ... } satisfies EmbeddingProvider & ProviderLinked<"siliconflow-cn">
 *
 * The `providerId` field is also the migration hook if Option A (full
 * ID-reference) is ever adopted: resolvers can read it instead of parsing
 * baseUrl.
 */
export type ProviderLinked<P extends keyof typeof REGISTRY> = {
  providerId: P;
  authType: (typeof REGISTRY)[P]["authType"];
  authHeader: (typeof REGISTRY)[P]["authHeader"];
};
