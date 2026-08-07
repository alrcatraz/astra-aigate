/**
 * Database module: InspectorSessions
 * CRUD + snapshot for inspector_sessions and inspector_session_requests tables.
 */

import { randomUUID } from "crypto";
import { getDbInstance, getAsyncDb } from "./core";
import type { InspectorSessionRow } from "./_rowTypes";
import { InterceptedRequestSchema } from "../../mitm/inspector/types";
import type { InterceptedRequest } from "../../mitm/inspector/types";

interface InspectorSessionDbRow {
  id: string;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  request_count: number;
  profile: string | null;
}

interface InspectorSessionRequestDbRow {
  session_id: string;
  seq: number;
  payload: string;
}

function mapSessionRow(row: InspectorSessionDbRow): InspectorSessionRow {
  return {
    id: row.id,
    name: row.name,
    started_at: row.started_at,
    ended_at: row.ended_at,
    request_count: row.request_count,
    profile: row.profile as "llm" | "custom" | "all" | null,
  };
}

export async function createSession(opts?: {
  name?: string;
  profile?: "llm" | "custom" | "all";
}): Promise<{ id: string; started_at: string }> {
  const db = await getAsyncDb();
  const id = randomUUID();
  const started_at = new Date().toISOString();

  await db
    .prepare(`INSERT INTO inspector_sessions (id, name, started_at, profile) VALUES (?, ?, ?, ?)`)
    .run(id, opts?.name ?? null, started_at, opts?.profile ?? null);

  return { id, started_at };
}

export async function stopSession(id: string): Promise<void> {
  const db = await getAsyncDb();
  const ended_at = new Date().toISOString();
  await db.prepare("UPDATE inspector_sessions SET ended_at = ? WHERE id = ?").run(ended_at, id);
}

export async function renameSession(id: string, name: string): Promise<void> {
  const db = await getAsyncDb();
  await db.prepare("UPDATE inspector_sessions SET name = ? WHERE id = ?").run(name, id);
}

export async function listSessions(): Promise<InspectorSessionRow[]> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare("SELECT * FROM inspector_sessions ORDER BY started_at DESC")
    .all()) as InspectorSessionDbRow[];
  return rows.map(mapSessionRow);
}

export async function getSession(id: string): Promise<InspectorSessionRow | null> {
  const db = await getAsyncDb();
  const row = (await db.prepare("SELECT * FROM inspector_sessions WHERE id = ?").get(id)) as
    InspectorSessionDbRow | undefined;
  return row ? mapSessionRow(row) : null;
}

export async function appendSessionRequest(sessionId: string, payload: string): Promise<number> {
  const db = await getAsyncDb();
  let insertedSeq = 0;

  const runTransaction = db.transaction(async () => {
    // Get next seq atomically within transaction
    const seqRow = (await db
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM inspector_session_requests WHERE session_id = ?"
      )
      .get(sessionId)) as { next_seq: number };

    const nextSeq = seqRow.next_seq;

    await db
      .prepare(`INSERT INTO inspector_session_requests (session_id, seq, payload) VALUES (?, ?, ?)`)
      .run(sessionId, nextSeq, payload);

    await db
      .prepare("UPDATE inspector_sessions SET request_count = request_count + 1 WHERE id = ?")
      .run(sessionId);

    insertedSeq = nextSeq;
  });

  await runTransaction();
  return insertedSeq;
}

export async function getSessionRequests(
  sessionId: string
): Promise<Array<{ seq: number; payload: string }>> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare(
      "SELECT seq, payload FROM inspector_session_requests WHERE session_id = ? ORDER BY seq ASC"
    )
    .all(sessionId)) as InspectorSessionRequestDbRow[];
  return rows.map((r) => ({ seq: r.seq, payload: r.payload }));
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getAsyncDb();
  // Cascade via FK ON DELETE CASCADE for inspector_session_requests
  await db.prepare("DELETE FROM inspector_sessions WHERE id = ?").run(id);
}

/**
 * Return a parsed + validated snapshot of all requests for the given session,
 * sorted by ascending seq.
 *
 * Returns null when the session does not exist.
 * Rows whose payload fails InterceptedRequestSchema validation are silently
 * skipped (defensive — protects callers from corrupt/partial rows).
 *
 * Satisfies master-plan §3.8 (F2 spec) named-export contract.
 */
export async function snapshotSession(sessionId: string): Promise<InterceptedRequest[] | null> {
  // 1. Verify session exists.
  const session = await getSession(sessionId);
  if (session === null) return null;

  // 2. Retrieve raw rows (already ordered by seq ASC).
  const rawRows = await getSessionRequests(sessionId);

  // 3. Parse each payload JSON, validate via Zod schema, skip bad rows.
  const results: InterceptedRequest[] = [];
  for (const row of rawRows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      // Corrupt JSON — skip.
      continue;
    }
    const result = InterceptedRequestSchema.safeParse(parsed);
    if (result.success) {
      results.push(result.data as InterceptedRequest);
    }
    // Invalid rows are silently skipped per defensive contract.
  }

  return results;
}
