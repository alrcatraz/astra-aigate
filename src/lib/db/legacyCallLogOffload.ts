/**
 * Legacy oversized call-log detail offload, extracted from core.ts.
 */

import type { SqliteAdapter } from "./adapters/types";
import { hasTable } from "./schemaColumns";
import { parseStoredPayload } from "../logPayloads";
import {
  buildArtifactRelativePath,
  writeCallArtifact,
  type CallLogArtifact,
} from "../usage/callLogArtifacts";

export function parseLegacyError(value: unknown): unknown {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function offloadLegacyCallLogDetails(db: SqliteAdapter) {
  if (!(await hasTable(db, "call_logs_v1_legacy"))) return;

  type LegacyCallLogRow = {
    id: string;
    timestamp: string | null;
    method: string | null;
    path: string | null;
    status: number | null;
    model: string | null;
    requested_model: string | null;
    provider: string | null;
    account: string | null;
    connection_id: string | null;
    duration: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    tokens_cache_read: number | null;
    tokens_cache_creation: number | null;
    tokens_reasoning: number | null;
    tokens_compressed: number | null;
    request_type: string | null;
    source_format: string | null;
    target_format: string | null;
    api_key_id: string | null;
    api_key_name: string | null;
    combo_name: string | null;
    combo_step_id: string | null;
    combo_execution_key: string | null;
    request_body: string | null;
    response_body: string | null;
    error: string | null;
  };

  const pendingRows = (await db
    .prepare(
      `
      SELECT legacy.*
      FROM call_logs_v1_legacy AS legacy
      JOIN call_logs AS current ON current.id = legacy.id
      WHERE current.detail_state = 'legacy-inline'
      ORDER BY legacy.timestamp ASC
    `
    )
    .all()) as LegacyCallLogRow[];

  if (pendingRows.length === 0) {
    await db.exec("DROP TABLE IF EXISTS call_logs_v1_legacy");
    return;
  }

  const updateStmt = db.prepare(`
    UPDATE call_logs
    SET artifact_relpath = @artifactRelPath,
        artifact_size_bytes = @artifactSizeBytes,
        artifact_sha256 = @artifactSha256,
        detail_state = 'ready'
    WHERE id = @id
  `);
  const markMissingStmt = db.prepare(`
    UPDATE call_logs
    SET detail_state = 'missing',
        artifact_relpath = NULL,
        artifact_size_bytes = NULL,
        artifact_sha256 = NULL
    WHERE id = ?
  `);

  let failed = 0;
  const tx = db.transaction(async () => {
    for (const row of pendingRows) {
      const artifact: CallLogArtifact = {
        schemaVersion: 5,
        summary: {
          id: row.id,
          timestamp: row.timestamp || new Date().toISOString(),
          method: row.method || "POST",
          path: row.path || "/v1/chat/completions",
          status: row.status || 0,
          model: row.model || "-",
          requestedModel: row.requested_model || null,
          provider: row.provider || "-",
          account: row.account || "-",
          connectionId: row.connection_id || null,
          duration: row.duration || 0,
          tokens: {
            in: row.tokens_in || 0,
            out: row.tokens_out || 0,
            cacheRead: row.tokens_cache_read ?? null,
            cacheWrite: row.tokens_cache_creation ?? null,
            reasoning: row.tokens_reasoning ?? null,
            compressed: row.tokens_compressed ?? null,
          },
          requestType: row.request_type || null,
          sourceFormat: row.source_format || null,
          targetFormat: row.target_format || null,
          apiKeyId: row.api_key_id || null,
          apiKeyName: row.api_key_name || null,
          comboName: row.combo_name || null,
          comboStepId: row.combo_step_id || null,
          comboExecutionKey: row.combo_execution_key || null,
        },
        requestBody: parseStoredPayload(row.request_body),
        responseBody: parseStoredPayload(row.response_body),
        error: parseLegacyError(row.error),
      };

      const artifactResult = writeCallArtifact(
        artifact,
        buildArtifactRelativePath(artifact.summary.timestamp, artifact.summary.id)
      );
      if (!artifactResult) {
        failed++;
        await markMissingStmt.run(row.id);
        continue;
      }

      await updateStmt.run({
        id: row.id,
        artifactRelPath: artifactResult.relPath,
        artifactSizeBytes: artifactResult.sizeBytes,
        artifactSha256: artifactResult.sha256,
      });
    }
  });

  await tx();

  if (failed > 0) {
    console.warn(
      `[DB] Kept call_logs_v1_legacy after partial call log offload (${failed} failed row(s)).`
    );
    return;
  }

  await db.exec("DROP TABLE IF EXISTS call_logs_v1_legacy");
  try {
    await db.pragma("wal_checkpoint(TRUNCATE)");
    await db.exec("VACUUM");
    console.log(`[DB] Offloaded ${pendingRows.length} legacy call log detail row(s) to artifacts.`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[DB] Legacy call log compaction finished without VACUUM:", message);
  }
}
