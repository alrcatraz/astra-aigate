/**
 * db/semanticCache.ts — CRUD queries over the `semantic_cache` table.
 * Extracted from the /api/cache/entries route handler.
 *
 * Hard Rule #5: routes must not embed raw SQL — these queries live here so the
 * /api/cache/entries route can delegate.
 *
 * Sliced out of #3500 (semantic_cache cluster, slice 4).
 */

import { getDbInstance, getAsyncDb } from "./core";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SemanticCacheEntry {
  id: string;
  signature: string;
  model: string;
  hit_count: number;
  tokens_saved: number;
  created_at: string;
  expires_at: string;
}

export interface SemanticCacheListOptions {
  page: number;
  limit: number;
  search: string;
  model: string;
  sortBy: string;
  sortOrder: string;
}

export interface SemanticCacheListResult {
  entries: SemanticCacheEntry[];
  total: number;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const VALID_SORT_COLUMNS = ["created_at", "expires_at", "hit_count", "tokens_saved", "model"];

/**
 * Returns a paginated, filtered, sorted list of semantic cache entries.
 * All dynamic inputs (sortBy/sortOrder) are validated before use.
 */
export async function listSemanticCacheEntries(
  opts: SemanticCacheListOptions
): Promise<SemanticCacheListResult> {
  const db = await getAsyncDb();
  const { page, limit, search, model, sortBy, sortOrder } = opts;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    conditions.push("(signature LIKE ? OR model LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (model) {
    conditions.push("model = ?");
    params.push(model);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = VALID_SORT_COLUMNS.includes(sortBy) ? sortBy : "created_at";
  const order = sortOrder === "asc" ? "ASC" : "DESC";

  const countRow = (await db
    .prepare(`SELECT COUNT(*) as total FROM semantic_cache ${whereClause}`)
    .get(...params)) as { total: number };

  const entries = (await db
    .prepare(
      `SELECT id, signature, model, hit_count, tokens_saved, created_at, expires_at
       FROM semantic_cache ${whereClause}
       ORDER BY ${orderBy} ${order}
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as SemanticCacheEntry[];

  return { entries, total: countRow?.total || 0 };
}

export interface DeleteSemanticCacheBySignatureResult {
  deleted: number;
}

/**
 * Deletes the single semantic cache entry matching the given signature.
 * Returns `{ deleted: 1 }` on success.
 */
export async function deleteSemanticCacheBySignature(
  signature: string
): Promise<DeleteSemanticCacheBySignatureResult> {
  const db = await getAsyncDb();
  await db.prepare("DELETE FROM semantic_cache WHERE signature = ?").run(signature);
  return { deleted: 1 };
}

export interface DeleteSemanticCacheByModelResult {
  deleted: number;
}

/**
 * Deletes all semantic cache entries for the given model.
 * Returns `{ deleted: N }` where N is the number of rows removed.
 */
export async function deleteSemanticCacheByModel(
  model: string
): Promise<DeleteSemanticCacheByModelResult> {
  const db = await getAsyncDb();
  const result = await db.prepare("DELETE FROM semantic_cache WHERE model = ?").run(model);
  return { deleted: result.changes };
}
