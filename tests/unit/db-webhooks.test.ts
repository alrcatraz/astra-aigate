import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-db-webhooks-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const coreDb = await import("../../src/lib/db/core.ts");
const webhooksDb = await import("../../src/lib/db/webhooks.ts");

async function resetStorage() {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  coreDb.getDbInstance();
  await coreDb.awaitDbMigrations();
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("webhooks create, update, query enabled hooks and delete records", async () => {
  const created = await webhooksDb.createWebhook({
    url: "https://example.com/hook",
    events: ["request.completed"],
    description: "Primary webhook",
  });

  assert.match(created.secret, /^whsec_/);
  assert.equal(webhooksDb.getWebhooks().webhooks.length, 1);
  assert.equal(webhooksDb.getEnabledWebhooks().length, 1);

  const updated = await webhooksDb.updateWebhook(created.id, {
    enabled: false,
    events: ["request.failed"],
    secret: "custom-secret",
    description: "Updated webhook",
  });

  assert.equal(updated.enabled, false);
  assert.deepEqual(updated.events, ["request.failed"]);
  assert.equal(updated.secret, "custom-secret");
  assert.equal(webhooksDb.getEnabledWebhooks().length, 0);

  assert.equal(webhooksDb.deleteWebhook(created.id), true);
  assert.equal(webhooksDb.deleteWebhook(created.id), false);
});

test("webhooks record delivery success and failures", async () => {
  const created = await webhooksDb.createWebhook({
    url: "https://example.com/hook",
  });

  await webhooksDb.recordWebhookDelivery(created.id, 500, false);
  await webhooksDb.recordWebhookDelivery(created.id, 502, false);
  let stored = await webhooksDb.getWebhook(created.id);

  assert.equal(stored.failure_count, 2);
  assert.equal(stored.last_status, 502);

  await webhooksDb.recordWebhookDelivery(created.id, 200, true);
  stored = await webhooksDb.getWebhook(created.id);

  assert.equal(stored.failure_count, 0);
  assert.equal(stored.last_status, 200);
  assert.ok(stored.last_triggered_at);
});

test("webhooks disable only hooks above the failure threshold", async () => {
  const a = await webhooksDb.createWebhook({ url: "https://example.com/a" });
  const b = await webhooksDb.createWebhook({ url: "https://example.com/b" });

  for (let i = 0; i < 3; i++) {
    await webhooksDb.recordWebhookDelivery(a.id, 500, false);
  }
  await webhooksDb.recordWebhookDelivery(b.id, 500, false);

  const disabled = await webhooksDb.disableWebhooksWithHighFailures(2);

  assert.equal(disabled, 1);
  assert.equal(webhooksDb.getWebhook(a.id).enabled, false);
  assert.equal(webhooksDb.getWebhook(b.id).enabled, true);
  assert.equal(webhooksDb.updateWebhook("ghost", { enabled: false }), null);
});
