import { getAsyncDb } from "./core";
import type { RawSyncDb } from "./adapters/types";

// Sync view of the shared DB singleton (see featureFlags.ts for the same
// pattern). These helpers sit in the synchronous call stack.
function syncDb(): RawSyncDb {
  return getAsyncDb() as unknown as RawSyncDb;
}

const ENCRYPTED_COLUMNS = ["api_key", "access_token", "refresh_token", "id_token"] as const;

const ENCRYPTED_PATTERN = "enc:v1:%";

function buildWhereClause(): string {
  return ENCRYPTED_COLUMNS.map((col) => `${col} LIKE '${ENCRYPTED_PATTERN}'`).join(" OR ");
}

export function countEncryptedCredentials(): number {
  const where = buildWhereClause();
  const row = syncDb()
    .prepare(`SELECT COUNT(*) AS cnt FROM provider_connections WHERE ${where}`)
    .get() as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

export async function resetEncryptedColumns({
  dryRun,
}: {
  dryRun: boolean;
}): Promise<{ affected: number }> {
  const affected = await countEncryptedCredentials();
  if (dryRun || affected === 0) return { affected };

  const nullCols = ENCRYPTED_COLUMNS.map((col) => `${col} = NULL`).join(", ");
  const where = buildWhereClause();
  await syncDb().prepare(`UPDATE provider_connections SET ${nullCols} WHERE ${where}`).run();

  return { affected };
}
