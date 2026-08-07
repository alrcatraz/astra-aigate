import { getAsyncDb } from "./core";

interface SecretRow {
  value?: string;
}

export async function getPersistedSecret(key: string): Promise<string | null> {
  try {
    const db = getAsyncDb();
    const row = (await db
      .prepare("SELECT value FROM key_value WHERE namespace = 'secrets' AND key = ?")
      .get(key)) as SecretRow | undefined;
    return typeof row?.value === "string" ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

export async function persistSecret(key: string, value: string): Promise<void> {
  try {
    const db = getAsyncDb();
    await db
      .prepare("INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('secrets', ?, ?)")
      .run(key, JSON.stringify(value));
  } catch {
    // Non-fatal: secrets still work for the current process if persistence fails.
  }
}
