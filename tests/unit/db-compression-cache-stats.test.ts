import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { recordCacheStats, getCacheStatsSummary } from "../../src/lib/db/compressionCacheStats.ts";

// `compression_cache_stats` is provisioned by migration 039, and the migration
// runner is fired off asynchronously by the first DB open — join the barrier
// before the first query or the table does not exist yet.
const core = await import("../../src/lib/db/core.ts");
core.getDbInstance();
await core.awaitDbMigrations();

describe("compressionCacheStats", () => {
  it("getCacheStatsSummary returns summary", async () => {
    const summary = await getCacheStatsSummary();
    assert.ok(typeof summary.totalRequests === "number");
    assert.ok(typeof summary.avgNetSavings === "number");
    assert.ok(typeof summary.cacheHitRate === "number");
    assert.ok(typeof summary.byProvider === "object");
  });

  it("recordCacheStats inserts and getCacheStatsSummary retrieves", async () => {
    await recordCacheStats({
      provider: "test-provider",
      model: "test-model",
      compressionMode: "lite",
      cacheControlPresent: true,
      estimatedCacheHit: true,
      tokensSavedCompression: 100,
      tokensSavedCaching: 50,
      netSavings: 150,
    });
    const summary = await getCacheStatsSummary();
    assert.ok(summary.totalRequests >= 1, "should have at least 1 request");
    assert.ok("test-provider" in summary.byProvider, "should have test-provider");
  });

  it("recordCacheStats handles missing model", async () => {
    await recordCacheStats({
      provider: "no-model-provider",
      compressionMode: "standard",
      cacheControlPresent: false,
      estimatedCacheHit: false,
      tokensSavedCompression: 0,
      tokensSavedCaching: 0,
      netSavings: 0,
    });
    const summary = await getCacheStatsSummary();
    assert.ok("no-model-provider" in summary.byProvider);
  });

  it("getCacheStatsSummary with since filter", async () => {
    const future = new Date(Date.now() + 86400000);
    const summary = await getCacheStatsSummary(future);
    assert.equal(summary.totalRequests, 0, "future date should return 0");
  });
});
