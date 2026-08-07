import { getDbInstance, getAsyncDb } from "../db/core";

// #5618 — node:sqlite's StatementSync.all() materializes the ENTIRE result set as
// JS objects at once. On a large storage.sqlite (~170 MB+) an unbounded
// `SELECT … FROM call_logs` over the whole table blows the V8 heap during the
// startup cleanup pass (`cleanupExpiredLogs` → `rotateCallLogs`), crashing the
// daemon before it binds. These helpers page through call_logs in bounded chunks
// so peak memory stays flat regardless of table size.
const CALL_LOG_QUERY_PAGE = 5000;

/**
 * Collect every non-null `artifact_relpath` referenced by call_logs, paging with
 * LIMIT/OFFSET so a huge table never loads into memory in one `.all()`.
 */
export async function collectReferencedArtifacts(): Promise<Set<string>> {
  const db = await getAsyncDb();
  const referenced = new Set<string>();
  const stmt = await db.prepare(
    "SELECT artifact_relpath FROM call_logs WHERE artifact_relpath IS NOT NULL LIMIT ? OFFSET ?"
  );
  for (let offset = 0; ; offset += CALL_LOG_QUERY_PAGE) {
    const rows = (await stmt.all(CALL_LOG_QUERY_PAGE, offset)) as Array<{
      artifact_relpath: string | null;
    }>;
    for (const row of rows) {
      if (typeof row.artifact_relpath === "string") referenced.add(row.artifact_relpath);
    }
    if (rows.length < CALL_LOG_QUERY_PAGE) break;
  }
  return referenced;
}

/**
 * Select one bounded page of call_log ids older than `cutoff` (oldest first).
 * Callers loop until it returns an empty page, deleting each batch, so the id
 * list never grows to the full retention backlog at once.
 */
export async function selectCallLogIdsBefore(
  cutoff: string,
  limit = CALL_LOG_QUERY_PAGE
): Promise<string[]> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare("SELECT id FROM call_logs WHERE timestamp < ? ORDER BY timestamp ASC LIMIT ?")
    .all(cutoff, limit)) as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}
