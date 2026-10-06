#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACK_ARTIFACT_ALLOWED_EXACT_PATHS,
  PACK_ARTIFACT_ALLOWED_PATH_PREFIXES,
  PACK_ARTIFACT_REQUIRED_PATHS,
  findMissingArtifactPaths,
  findUnexpectedArtifactPaths,
} from "./pack-artifact-policy.ts";

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = dirname(__filename);
const ROOT: string = join(__dirname, "..", "..");
const npmCommand: string = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpm(args: string[], stdio: "inherit" | "pipe" = "pipe"): string {
  const npmExecPath = process.env.npm_execpath;
  const isBunRuntime = "Bun" in globalThis;
  const command = npmExecPath && !isBunRuntime ? process.execPath : npmCommand;
  const commandArgs = npmExecPath && !isBunRuntime ? [npmExecPath, ...args] : args;

  return execFileSync(command, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function ensureAppStagingReady(): void {
  const missingAppRequiredPaths = PACK_ARTIFACT_REQUIRED_PATHS.filter((requiredPath) =>
    requiredPath.startsWith("dist/")
  ).filter((requiredPath) => !existsSync(join(ROOT, requiredPath)));

  if (missingAppRequiredPaths.length === 0) return;

  console.log("📦 dist/ staging is missing required runtime files; running npm run build:cli...");
  runNpm(["run", "build:cli"], "inherit");
}

/**
 * Extract the FIRST balanced JSON array from npm's output.
 *
 * npm may append notice/summary lines after the payload (observed in CI:
 * the array ends mid-stream and trailing lines contain `]`, so the old
 * `indexOf("[")..lastIndexOf("]")` slice swallowed them and JSON.parse
 * failed with "Unexpected non-whitespace character after JSON"). Scanning
 * for the bracket-balanced extent of the first array makes the parse
 * immune to whatever npm prints around it.
 *
 * Returns `{ parsed, kind }` where `kind` reports the payload shape
 * ("array" | "object" | "primitive" | "none") so callers can produce a
 * self-diagnosing error when the shape is unexpected (guix CI can surface
 * an npm error OBJECT with no files[] at all).
 */
function extractFirstJsonArray(output: string): { parsed: unknown; kind: string } {
  // Prefer the first balanced ARRAY (the normal npm --json payload).
  let start = output.indexOf("[");
  while (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < output.length; i++) {
      const ch = output[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          try {
            return { parsed: JSON.parse(output.slice(start, i + 1)), kind: "array" };
          } catch {
            break; // not actually JSON — try the next '['
          }
        }
      }
    }
    start = output.indexOf("[", start + 1);
  }

  // No balanced array: fall back to the first balanced OBJECT (npm error payloads
  // surface as `{"error": ...}` with no files[]). A string-aware brace scan keeps
  // this immune to trailing notices too.
  const objStart = output.indexOf("{");
  if (objStart >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = objStart; i < output.length; i++) {
      const ch = output[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return { parsed: JSON.parse(output.slice(objStart, i + 1)), kind: "object" };
          } catch {
            break;
          }
        }
      }
    }
  }

  return { parsed: null, kind: "none" };
}

function describeShape(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `array[len=${value.length}]`;
  if (typeof value === "object") return `object{${Object.keys(value as object).join(",")}}`;
  return typeof value;
}

function runPackDryRun(): any {
  const output = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"]);

  const { parsed, kind } = extractFirstJsonArray(output);
  const packReport = Array.isArray(parsed)
    ? parsed[0]
    : parsed && typeof parsed === "object"
      ? parsed
      : null;

  if (!packReport || !Array.isArray(packReport.files)) {
    // Surface what npm ACTUALLY returned (truncated) so the next CI failure
    // diagnoses itself instead of leaving us guessing the payload shape.
    const preview = (() => {
      try {
        return JSON.stringify(parsed)?.slice(0, 400) ?? String(parsed).slice(0, 400);
      } catch {
        return String(parsed).slice(0, 400);
      }
    })();
    throw new Error(
      `npm pack --dry-run --json did not return the expected files[] payload. ` +
        `topLevel=${kind} parsed=${describeShape(parsed)} preview=${preview}`
    );
  }

  return packReport;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes || 0} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

// --policy-only: skip the build (ensureAppStagingReady → build:cli) and the
// required-runtime-files check (which needs the built dist/), running ONLY the
// unexpected-files allowlist check. The unexpected files (e.g. stray bin/*.sh) are
// SOURCE files that `npm pack --dry-run` lists regardless of build, so this catches
// the "new file leaked into the tarball" regression cheaply on the fast-path (PR→release),
// instead of only on the release PR's full Package Artifact job. See incident v3.8.36 (#5029).
const POLICY_ONLY = process.argv.includes("--policy-only");

try {
  if (!POLICY_ONLY) ensureAppStagingReady();
  const packReport = runPackDryRun();
  const artifactPaths: string[] = packReport.files.map((file: any) => file.path);
  const unexpectedPaths: string[] = findUnexpectedArtifactPaths(artifactPaths, {
    exactPaths: PACK_ARTIFACT_ALLOWED_EXACT_PATHS,
    prefixPaths: PACK_ARTIFACT_ALLOWED_PATH_PREFIXES,
  });
  const missingRequiredPaths: string[] = POLICY_ONLY
    ? []
    : findMissingArtifactPaths(artifactPaths, PACK_ARTIFACT_REQUIRED_PATHS);

  console.log("📦 npm pack artifact summary");
  console.log(`   File:          ${packReport.filename}`);
  console.log(`   Entry count:   ${packReport.entryCount}`);
  console.log(`   Packed size:   ${formatBytes(packReport.size)}`);
  console.log(`   Unpacked size: ${formatBytes(packReport.unpackedSize)}`);

  if (unexpectedPaths.length > 0) {
    console.error("\n❌ Unexpected files were found in the npm publish artifact:");
    for (const unexpectedPath of unexpectedPaths) {
      console.error(`   - ${unexpectedPath}`);
    }
  }

  if (missingRequiredPaths.length > 0) {
    console.error("\n❌ Required runtime files are missing from the npm publish artifact:");
    for (const missingPath of missingRequiredPaths) {
      console.error(`   - ${missingPath}`);
    }
  }

  if (unexpectedPaths.length > 0 || missingRequiredPaths.length > 0) {
    process.exit(1);
  }

  console.log("\n✅ Pack artifact policy check passed.");
} catch (error) {
  console.error(`\n❌ Pack artifact validation failed: ${error.message}`);
  process.exit(1);
}
