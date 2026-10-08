import { test } from "node:test";
import assert from "node:assert";
import {
  findOrphanRegistryIds,
  KNOWN_REGISTRY_ONLY,
} from "../../scripts/check/check-provider-consistency.ts";
import { reportStaleEntries } from "../../scripts/check/lib/allowlist.mjs";

const known = new Set(["openai", "anthropic", "gemini"]);
const isKnown = (id: string) => known.has(id);

test("no orphans when every registry id is a known provider", () => {
  assert.deepEqual(findOrphanRegistryIds(["openai", "anthropic"], isKnown, {}), []);
});

test("flags a registry id that is not a canonical provider (hallucinated/half-registered)", () => {
  assert.deepEqual(findOrphanRegistryIds(["openai", "ghostprovider"], isKnown, {}), [
    "ghostprovider",
  ]);
});

test("allowlisted ids are not flagged", () => {
  assert.deepEqual(
    findOrphanRegistryIds(["openai", "krutrim"], isKnown, { krutrim: "pré-existente" }),
    []
  );
});

test("flags multiple orphans, preserves order", () => {
  assert.deepEqual(findOrphanRegistryIds(["a", "openai", "b"], isKnown, {}), ["a", "b"]);
});

// --- stale-allowlist enforcement (6A.3) ---

test("stale-enforcement: allowlist entry no longer needed causes gate to flag it", () => {
  // Simulate an allowlist with an entry that no longer has a live violation.
  const liveOrphans: string[] = []; // violation was corrected
  const stale = (reportStaleEntries as (a: string[], l: string[], g: string) => string[])(
    ["now-registered-provider"],
    liveOrphans,
    "provider-consistency"
  );
  assert.deepEqual(stale, ["now-registered-provider"]);
});

test("stale-enforcement: every KNOWN_REGISTRY_ONLY entry is justified and still suppresses a live orphan", async () => {
  // KNOWN_REGISTRY_ONLY may hold documented pre-existing exceptions (e.g. dmxapi,
  // a shared engine id with no canonical provider by design). The invariants that
  // actually matter: every entry carries a non-empty justification AND is not stale
  // (it must still correspond to a registry id that has no canonical provider).
  const { AI_PROVIDERS, getProviderById } = await import("@/shared/constants/providers.ts");
  const { REGISTRY } = await import("@omniroute/open-sse/config/providerRegistry.ts");

  const canonical = new Set(Object.keys(AI_PROVIDERS));
  const isKnown = (id: string) => canonical.has(id) || Boolean(getProviderById(id));
  const liveOrphans = Object.keys(REGISTRY).filter((id) => !isKnown(id));

  for (const [id, justification] of Object.entries(KNOWN_REGISTRY_ONLY as Record<string, string>)) {
    assert.ok(
      typeof justification === "string" && justification.trim().length > 0,
      `KNOWN_REGISTRY_ONLY["${id}"] must carry a justification`
    );
    assert.ok(
      liveOrphans.includes(id),
      `KNOWN_REGISTRY_ONLY["${id}"] is stale — it no longer suppresses a live orphan; remove it`
    );
  }
  assert.deepEqual(
    Object.keys(KNOWN_REGISTRY_ONLY).filter((id) => !liveOrphans.includes(id)),
    [],
    "no stale entries may remain in KNOWN_REGISTRY_ONLY"
  );
});
