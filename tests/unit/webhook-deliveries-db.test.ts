import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-deliveries-"));
process.env.DATA_DIR = TEST_DIR;

const coreDb = await import("../../src/lib/db/core.ts");
const webhooksDb = await import("../../src/lib/db/webhooks.ts");
const deliveriesDb = await import("../../src/lib/db/webhookDeliveries.ts");

async function resetStorage() {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  coreDb.getDbInstance();
  await coreDb.awaitDbMigrations();
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test("insertDelivery stores a row and getDeliveries returns it", async () => {
  const wh = await webhooksDb.createWebhook({ url: "https://example.com/hook" });
  await deliveriesDb.insertDelivery({
    webhookId: wh.id,
    eventType: "request.failed",
    status: "delivered",
    httpStatus: 200,
    latencyMs: 142,
    payloadSnapshot: JSON.stringify({ event: "request.failed" }),
  });
  const rows = await deliveriesDb.getDeliveries(wh.id, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_type, "request.failed");
  assert.equal(rows[0].http_status, 200);
  assert.equal(rows[0].latency_ms, 142);
  assert.equal(rows[0].status, "delivered");
  assert.equal("payload_snapshot" in rows[0], false);
});

test("rotation keeps only last 100 deliveries per webhook", async () => {
  const wh = await webhooksDb.createWebhook({ url: "https://example.com/hook" });
  for (let i = 0; i < 105; i++) {
    await deliveriesDb.insertDelivery({
      webhookId: wh.id,
      eventType: "test.ping",
      status: "delivered",
      httpStatus: 200,
      latencyMs: 10,
    });
  }
  const rows = await deliveriesDb.getDeliveries(wh.id, 200);
  assert.equal(rows.length, 100);
});

test("getDeliveries respects limit parameter", async () => {
  const wh = await webhooksDb.createWebhook({ url: "https://example.com/hook" });
  for (let i = 0; i < 10; i++) {
    await deliveriesDb.insertDelivery({
      webhookId: wh.id,
      eventType: "test.ping",
      status: "delivered",
      httpStatus: 200,
      latencyMs: 10,
    });
  }
  const rows = await deliveriesDb.getDeliveries(wh.id, 5);
  assert.equal(rows.length, 5);
});

test("CASCADE delete removes deliveries when webhook is deleted", async () => {
  const wh = await webhooksDb.createWebhook({ url: "https://example.com/hook" });
  await deliveriesDb.insertDelivery({
    webhookId: wh.id,
    eventType: "test.ping",
    status: "delivered",
    httpStatus: 200,
    latencyMs: 10,
  });
  await webhooksDb.deleteWebhook(wh.id);
  const rows = await deliveriesDb.getDeliveries(wh.id, 10);
  assert.equal(rows.length, 0);
});

test("createWebhook uses kind=custom by default", async () => {
  const wh = await webhooksDb.createWebhook({ url: "https://example.com/hook" });
  assert.equal(wh.kind, "custom");
  assert.equal(wh.metadata_encrypted, null);
});

test("createWebhook accepts kind=slack", async () => {
  const wh = await webhooksDb.createWebhook({
    url: "https://hooks.slack.com/services/T/B/xxx",
    kind: "slack",
  });
  assert.equal(wh.kind, "slack");
});

test("updateWebhook can change kind and metadataEncrypted", async () => {
  const wh = await webhooksDb.createWebhook({ url: "https://example.com/hook" });
  const updated = await webhooksDb.updateWebhook(wh.id, {
    kind: "telegram",
    metadataEncrypted: "enc:v1:test",
  });
  assert.equal(updated?.kind, "telegram");
  assert.equal(updated?.metadata_encrypted, "enc:v1:test");
});
