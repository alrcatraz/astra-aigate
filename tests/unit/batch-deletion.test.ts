import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createFile,
  createBatch,
  getBatch,
  deleteBatch,
  deleteCompletedBatches,
  getFile,
  deleteFile,
} from "@/lib/localDb";
import { getDbInstance, awaitDbMigrations } from "@/lib/db/core";

describe("deleteBatch", () => {
  it("should delete a single batch and its associated files", async () => {
    // getDbInstance() opens the connection and kicks the versioned migration
    // runner off without awaiting it; the files/batches tables only exist once
    // the runner settles. Every test below writes through those tables, so open
    // the DB and join the migration barrier first — the shared convention in
    // tests/integration/*.
    getDbInstance();
    await awaitDbMigrations();
    const inputFile = await createFile({
      bytes: 10,
      filename: "single-delete-input.jsonl",
      purpose: "batch",
      content: Buffer.from("{}"),
    });

    const batch = await createBatch({
      endpoint: "/v1/chat/completions",
      completionWindow: "24h",
      inputFileId: inputFile.id,
      status: "completed",
    });

    assert.ok(await getBatch(batch.id));
    assert.ok(await getFile(inputFile.id));

    const result = await deleteBatch(batch.id);
    assert.strictEqual(result, true);

    assert.strictEqual(await getBatch(batch.id), null);
    assert.strictEqual(await getFile(inputFile.id), null);
  });

  it("should return false for a non-existent batch id", async () => {
    const result = await deleteBatch("batch_nonexistent");
    assert.strictEqual(result, false);
  });

  it("should delete a batch with all three file references", async () => {
    const inputFile = await createFile({
      bytes: 10,
      filename: "delete-all-input.jsonl",
      purpose: "batch",
      content: Buffer.from("input"),
    });
    const outputFile = await createFile({
      bytes: 20,
      filename: "delete-all-output.jsonl",
      purpose: "batch",
      content: Buffer.from("output"),
    });
    const errorFile = await createFile({
      bytes: 30,
      filename: "delete-all-error.jsonl",
      purpose: "batch",
      content: Buffer.from("error"),
    });

    const batch = await createBatch({
      endpoint: "/v1/chat/completions",
      completionWindow: "24h",
      inputFileId: inputFile.id,
      outputFileId: outputFile.id,
      errorFileId: errorFile.id,
      status: "completed",
    });

    assert.ok(await getFile(inputFile.id));
    assert.ok(await getFile(outputFile.id));
    assert.ok(await getFile(errorFile.id));

    const result = await deleteBatch(batch.id);
    assert.strictEqual(result, true);

    assert.strictEqual(await getBatch(batch.id), null);
    assert.strictEqual(await getFile(inputFile.id), null);
    assert.strictEqual(await getFile(outputFile.id), null);
    assert.strictEqual(await getFile(errorFile.id), null);
  });

  it("should delete a batch whose files were already deleted", async () => {
    const f = await createFile({
      bytes: 10,
      filename: "already-deleted-input.jsonl",
      purpose: "batch",
      content: Buffer.from("x"),
    });
    const batch = await createBatch({
      endpoint: "/v1/chat/completions",
      completionWindow: "24h",
      inputFileId: f.id,
      status: "completed",
    });

    // Delete the file first
    await deleteFile(f.id);

    assert.strictEqual(await getFile(f.id), null);
    assert.ok(await getBatch(batch.id));

    const result = await deleteBatch(batch.id);
    assert.strictEqual(result, true);
    assert.strictEqual(await getBatch(batch.id), null);
  });

  it("should delete a batch regardless of status", async () => {
    for (const status of [
      "validating",
      "in_progress",
      "finalizing",
      "cancelling",
      "failed",
      "cancelled",
      "expired",
    ] as const) {
      const f = await createFile({
        bytes: 10,
        filename: `delete-status-${status}.jsonl`,
        purpose: "batch",
        content: Buffer.from("x"),
      });
      const b = await createBatch({
        endpoint: "/v1/chat/completions",
        completionWindow: "24h",
        inputFileId: f.id,
        status,
      });
      assert.ok(await getBatch(b.id), `batch with status '${status}' should exist`);
      assert.strictEqual(
        await deleteBatch(b.id),
        true,
        `deleteBatch for status '${status}' should succeed`
      );
      assert.strictEqual(
        await getBatch(b.id),
        null,
        `batch with status '${status}' should be gone`
      );
      assert.strictEqual(await getFile(f.id), null, `file for status '${status}' should be gone`);
    }
  });
});

describe("deleteCompletedBatches", () => {
  it("should delete all completed batches and their associated files", async () => {
    // Create 3 completed batches with their own files
    const batchIds: string[] = [];
    const fileIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      const inputFile = await createFile({
        bytes: 10,
        filename: `bulk-input-${i}.jsonl`,
        purpose: "batch",
        content: Buffer.from("{}"),
      });
      fileIds.push(inputFile.id);

      const batch = await createBatch({
        endpoint: "/v1/chat/completions",
        completionWindow: "24h",
        inputFileId: inputFile.id,
        status: "completed",
      });
      batchIds.push(batch.id);
    }

    // Create a non-completed batch that should survive
    const liveInput = await createFile({
      bytes: 10,
      filename: "live-input.jsonl",
      purpose: "batch",
      content: Buffer.from("{}"),
    });
    const liveBatch = await createBatch({
      endpoint: "/v1/chat/completions",
      completionWindow: "24h",
      inputFileId: liveInput.id,
      status: "in_progress",
    });

    // Verify everything exists
    for (const id of batchIds) {
      assert.ok(await getBatch(id), `batch ${id} should exist`);
    }
    for (const id of fileIds) {
      assert.ok(await getFile(id), `file ${id} should exist`);
    }
    assert.ok(await getBatch(liveBatch.id));
    assert.ok(await getFile(liveInput.id));

    // Delete all completed (may include pre-existing ones from other tests)
    const result = await deleteCompletedBatches();
    assert.ok(result.deletedBatches >= 3, `expected >=3, got ${result.deletedBatches}`);
    assert.ok(result.deletedFiles >= 3, `expected >=3, got ${result.deletedFiles}`);

    // Verify completed batches and their files are gone
    for (const id of batchIds) {
      assert.strictEqual(await getBatch(id), null);
    }
    for (const id of fileIds) {
      assert.strictEqual(await getFile(id), null);
    }

    // Verify non-completed batch and its file survive
    assert.ok(await getBatch(liveBatch.id), "non-completed batch should survive");
    assert.ok(await getFile(liveInput.id), "non-completed batch's file should survive");
  });

  it("should return zero counts when no completed batches exist", async () => {
    const result = await deleteCompletedBatches();
    assert.strictEqual(result.deletedBatches, 0);
    assert.strictEqual(result.deletedFiles, 0);
  });

  it("should handle shared file IDs across multiple completed batches", async () => {
    const sharedFile = await createFile({
      bytes: 10,
      filename: "shared-input.jsonl",
      purpose: "batch",
      content: Buffer.from("shared"),
    });

    const batchA = await createBatch({
      endpoint: "/v1/chat/completions",
      completionWindow: "24h",
      inputFileId: sharedFile.id,
      status: "completed",
    });
    const batchB = await createBatch({
      endpoint: "/v1/chat/completions",
      completionWindow: "24h",
      inputFileId: sharedFile.id,
      status: "completed",
    });

    assert.ok(await getBatch(batchA.id));
    assert.ok(await getBatch(batchB.id));
    assert.ok(await getFile(sharedFile.id));

    const result = await deleteCompletedBatches();
    assert.ok(result.deletedBatches >= 2);
    assert.ok(result.deletedFiles >= 1, "shared file should be counted once");

    assert.strictEqual(await getBatch(batchA.id), null);
    assert.strictEqual(await getBatch(batchB.id), null);
    assert.strictEqual(await getFile(sharedFile.id), null);
  });
});
