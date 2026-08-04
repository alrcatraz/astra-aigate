#!/usr/bin/env node
/**
 * pg-smoke.ts — local PG-mode smoke test (no container build needed).
 *
 * Usage:
 *   DB_DRIVER=postgres DATABASE_URL=postgres://postgres:PASS@127.0.0.1:55432/postgres \
 *     node --import tsx/esm scripts/pg-smoke.ts
 *
 * Exercises the async DB layer against the real Postgres: boot hook, settings
 * (key_value), provider connections, usage history, compression combos.
 */
import { initDatabaseDriver, getAsyncDb } from "../src/lib/db/core";
import { getSettings } from "../src/lib/db/settings";
import { getProviderConnections } from "../src/lib/db/providers";
import { listCompressionCombos } from "../src/lib/db/compressionCombos";
import { getCompressionAnalyticsSummary } from "../src/lib/db/compressionAnalytics";
import { listBatches, countBatches, getPendingBatches } from "../src/lib/db/batches";
import { getVersionManagerStatus } from "../src/lib/db/versionManager";
import { getLKGP, setLKGP, clearAllLKGP } from "../src/lib/db/settings/lkgp";
import { getPricing } from "../src/lib/db/settings/pricing";
import { getApiKeys } from "../src/lib/db/apiKeys";
import { getCustomModels } from "../src/lib/db/models";
import { getCombos } from "../src/lib/db/combos";
import { getFeatureFlagOverrides } from "../src/lib/db/featureFlags";

let failures = 0;
function check(name: string, cond: unknown, extra = "") {
  const ok = cond !== false && cond !== undefined && cond !== null;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  await initDatabaseDriver();
  const db = getAsyncDb();
  check("driver is postgres", db.driver === "postgres", String(db.driver));

  const s = await getSettings();
  check("settings loaded", typeof s === "object", `keys=${Object.keys(s).length}`);

  const conns = await getProviderConnections();
  check("provider connections", Array.isArray(conns), `count=${conns.length}`);

  const combos = await listCompressionCombos();
  check("compression combos", Array.isArray(combos), `count=${combos.length}`);

  try {
    const summary = await getCompressionAnalyticsSummary();
    check("analytics summary", typeof summary === "object", `keys=${Object.keys(summary).length}`);
  } catch (err) {
    check("analytics summary", false, (err as Error).message);
  }

  try {
    const batches = await listBatches(undefined, 5);
    check("batch requests", Array.isArray(batches), `count=${batches.length}`);
    const total = await countBatches();
    check("batch count", typeof total === "number", `total=${total}`);
    const pending = await getPendingBatches();
    check("pending batches", Array.isArray(pending), `count=${pending.length}`);
  } catch (err) {
    check("batch requests", false, (err as Error).message);
  }

  try {
    const vm = await getVersionManagerStatus();
    check("version manager", typeof vm === "object", `keys=${Object.keys(vm).length}`);
  } catch (err) {
    check("version manager", false, (err as Error).message);
  }

  // Phase 2.8 login-chain modules: lkgp (upsert arbiter), pricing, and the
  // high-frequency business modules async-migrated in pg-4.
  try {
    await setLKGP("smoke-combo", "smoke-model", "smoke-provider", "smoke-conn");
    const lkgp = await getLKGP("smoke-combo", "smoke-model");
    check("lkgp upsert", lkgp?.provider === "smoke-provider", JSON.stringify(lkgp));
    await clearAllLKGP();
    check("lkgp clear", (await getLKGP("smoke-combo", "smoke-model")) == null, "");
  } catch (err) {
    check("lkgp upsert", false, (err as Error).message);
  }

  try {
    const p = await getPricing();
    check("pricing", typeof p === "object", `providers=${Object.keys(p).length}`);
  } catch (err) {
    check("pricing", false, (err as Error).message);
  }

  try {
    const keys = await getApiKeys();
    check("api keys", Array.isArray(keys), `count=${keys.length}`);
  } catch (err) {
    check("api keys", false, (err as Error).message);
  }

  try {
    const models = await getCustomModels();
    check("custom models", typeof models === "object", `keys=${Object.keys(models).length}`);
  } catch (err) {
    check("custom models", false, (err as Error).message);
  }

  try {
    const combos = await getCombos();
    check("combos", Array.isArray(combos), `count=${combos.length}`);
  } catch (err) {
    check("combos", false, (err as Error).message);
  }

  try {
    const ff = getFeatureFlagOverrides();
    check("feature flags (sync)", typeof ff === "object", `count=${Object.keys(ff).length}`);
  } catch (err) {
    check("feature flags (sync)", false, (err as Error).message);
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE CRASH:", err);
  process.exit(1);
});
