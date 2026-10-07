/**
 * Migrations-directory resolution, extracted from migrationRunner.ts. Lives
 * in the same directory on purpose: the discovery walk starts from
 * `import.meta.url`, so keeping the leaf beside the host preserves the
 * exact search behaviour.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Resolve the migrations directory path safely across platforms.
 * On Windows with global npm installs, `import.meta.url` may not be a valid
 * `file://` URL, causing `fileURLToPath` to throw `ERR_INVALID_FILE_URL_PATH`.
 */
function resolveMigrationsDir(): string {
  const configuredDir = process.env.OMNIROUTE_MIGRATIONS_DIR;
  if (typeof configuredDir === "string" && configuredDir.trim().length > 0) {
    return path.resolve(configuredDir);
  }

  const checkLocations = (basePath: string) => {
    const locations = [
      path.join(basePath, "migrations"),
      path.join(basePath, "src", "lib", "db", "migrations"),
      path.join(basePath, "app", "src", "lib", "db", "migrations"),
    ];
    for (const loc of locations) {
      if (fs.existsSync(loc)) return loc;
    }
    return null;
  };

  try {
    let currentDir = path.dirname(fileURLToPath(import.meta.url));
    while (currentDir !== path.dirname(currentDir)) {
      const found = checkLocations(currentDir);
      if (found) return found;
      currentDir = path.dirname(currentDir);
    }
  } catch {
    // Fall through to more defensive URL parsing below.
  }

  // Fix #1704: On Windows with global npm installs, import.meta.url may contain
  // CI build-time paths (e.g., /home/runner/work/...) that are not valid file://
  // URLs on Windows. Extract the path portion directly and normalize it.
  const metaUrl = import.meta.url;
  if (typeof metaUrl === "string" && metaUrl.startsWith("file://")) {
    try {
      // Strip the file:// prefix and decode, then normalize for the platform
      const rawPath = decodeURIComponent(
        metaUrl.replace(/^file:\/\/\//, "/").replace(/^file:\/\//, "")
      );
      let currentDir = path.dirname(path.resolve(rawPath));
      while (currentDir !== path.dirname(currentDir)) {
        const found = checkLocations(currentDir);
        if (found) return found;
        currentDir = path.dirname(currentDir);
      }
    } catch {
      // Fall through to process.cwd fallback
    }
  }

  // Last resort: use process.cwd to find migrations relative to the app root
  const fromCwd = checkLocations(process.cwd());
  if (fromCwd) return fromCwd;

  throw new Error(
    "[Migration] Could not resolve migrations directory. Set OMNIROUTE_MIGRATIONS_DIR."
  );
}

export const MIGRATIONS_DIR = resolveMigrationsDir();
