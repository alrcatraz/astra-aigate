// Regression for #6131: the IP filter config lived in memory only, so every
// restart (i.e. every OmniRoute update) reset it to Disabled + empty lists and
// blacklisted IPs were never actually blocked. This locks the fix:
//   1. configure/blacklist persists to the DB and survives a simulated restart;
//   2. after the restart the blacklisted IP is still blocked by checkIP.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ipfilter-6131-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const ipFilter = await import("../../open-sse/services/ipFilter.ts");

test.after(async () => {
  await core.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test.beforeEach(async () => {
  // Fresh DB per test + fresh in-memory module state.
  await core.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  ipFilter.resetIPFilter();
  core.getDbInstance();
  await core.awaitDbMigrations();
});

// Simulate an OmniRoute restart: the module's in-memory state is wiped (as it
// would be on a fresh import) but the DB file persists — exactly what happens
// across an update/restart.
//
// ensureLoaded() applies the persisted config in a fire-and-forget promise
// (.then), so the caller must flush the microtask/immediate queue before
// reading the config back — otherwise every accessor still sees the defaults.
async function simulateRestart() {
  ipFilter.resetIPFilter();
  // The first accessor call after the reset is what FIRES ensureLoaded()'s
  // fire-and-forget read (its .then applies the persisted config later), so
  // trigger it here and only then flush the promise before the assertions.
  ipFilter.getIPFilterConfig();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("#6131 blacklist + enabled survive a restart (persisted to DB)", async () => {
  ipFilter.configureIPFilter({ enabled: true, mode: "blacklist" });
  ipFilter.addToBlacklist("203.0.113.7");
  ipFilter.addToBlacklist("198.51.100.42");

  await simulateRestart();

  const cfg = ipFilter.getIPFilterConfig();
  assert.equal(cfg.enabled, true, "enabled must persist across restart");
  assert.equal(cfg.mode, "blacklist");
  assert.deepEqual(cfg.blacklist.sort(), ["198.51.100.42", "203.0.113.7"]);
});

test("#6131 blacklisted IP is still blocked after a restart", async () => {
  ipFilter.configureIPFilter({ enabled: true, mode: "blacklist" });
  ipFilter.addToBlacklist("203.0.113.7");

  await simulateRestart();

  assert.equal(ipFilter.checkIP("203.0.113.7").allowed, false);
  assert.equal(ipFilter.checkIP("203.0.113.8").allowed, true);
});

test("#6131 removing an IP and disabling also persist across restart", async () => {
  ipFilter.configureIPFilter({ enabled: true, mode: "blacklist" });
  ipFilter.addToBlacklist("203.0.113.7");
  ipFilter.addToBlacklist("203.0.113.8");
  ipFilter.removeFromBlacklist("203.0.113.7");
  ipFilter.configureIPFilter({ enabled: false });

  await simulateRestart();

  const cfg = ipFilter.getIPFilterConfig();
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.blacklist, ["203.0.113.8"]);
  // Disabled → everything allowed regardless of the persisted blacklist.
  assert.equal(ipFilter.checkIP("203.0.113.8").allowed, true);
});

test("#6131 whitelist mode persists across restart", async () => {
  ipFilter.configureIPFilter({ enabled: true, mode: "whitelist" });
  ipFilter.addToWhitelist("203.0.113.7");

  await simulateRestart();

  const cfg = ipFilter.getIPFilterConfig();
  assert.equal(cfg.mode, "whitelist");
  assert.deepEqual(cfg.whitelist, ["203.0.113.7"]);
  assert.equal(ipFilter.checkIP("203.0.113.7").allowed, true);
  assert.equal(ipFilter.checkIP("10.0.0.1").allowed, false);
});

test("#6131 defaults are safe when nothing was ever persisted (disabled, allow-all)", async () => {
  await simulateRestart();
  const cfg = ipFilter.getIPFilterConfig();
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.blacklist, []);
  assert.equal(ipFilter.checkIP("203.0.113.7").allowed, true);
});
