import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { getDbInstance, resetDbInstanceDrained, awaitDbMigrations } from "../../src/lib/db/core";

// Bootstrap: open the DB and drain async migrations before the first test
// (the PRAGMA reads below need the family column the migration adds).
getDbInstance();
await awaitDbMigrations();

describe("migration 099 proxy family column", () => {
  after(async () => await resetDbInstanceDrained());
  it("adds a family column defaulting to 'auto' on proxy_registry", () => {
    const db = getDbInstance();
    const cols = db.prepare("PRAGMA table_info(proxy_registry)").all() as Array<{ name: string }>;
    assert.ok(
      cols.some((c) => c.name === "family"),
      "proxy_registry.family must exist"
    );
  });
  it("adds a family column on upstream_proxy_config", () => {
    const db = getDbInstance();
    const cols = db.prepare("PRAGMA table_info(upstream_proxy_config)").all() as Array<{
      name: string;
    }>;
    assert.ok(
      cols.some((c) => c.name === "family"),
      "upstream_proxy_config.family must exist"
    );
  });
});
