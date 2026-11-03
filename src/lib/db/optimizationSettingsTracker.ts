/**
 * Tracks the in-flight promise of the stored optimization-settings apply
 * (cache_size override) kicked off on every DB open. Extracted from core.ts to
 * keep the sync-DB facade lean; core.ts assigns on open/reset, consumers await.
 *
 * No DB access happens here — this module only holds the promise, so it is
 * driver-agnostic and needs no async-adapter migration of its own.
 */
let optimizationSettingsPromise: Promise<void> = Promise.resolve();

/** Record the apply promise started by the DB open path for the current DB. */
export function setDbOptimizationSettingsPromise(promise: Promise<void>): void {
  optimizationSettingsPromise = promise;
}

/**
 * Wait for the stored optimization settings (cache_size) of the CURRENT
 * database instance to be applied. The DB open path applies the default
 * cache_size synchronously and then kicks the stored-value override off
 * asynchronously; tests that reopen the DB and assert the pragma must await
 * this first. Resolves immediately when no apply is in flight.
 */
export async function awaitDbOptimizationSettings(): Promise<void> {
  await optimizationSettingsPromise;
}
