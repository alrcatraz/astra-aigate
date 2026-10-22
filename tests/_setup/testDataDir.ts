import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Create an isolated temp data dir for a test file and point `DATA_DIR` at it.
 * Replaces the repeated `mkdtemp` + env-assignment boilerplate that every
 * route/service test file used to inline.
 */
export function setupTestDataDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = dir;
  return dir;
}
