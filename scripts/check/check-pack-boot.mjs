#!/usr/bin/env node
/**
 * check:pack-boot — boot-smoke of the REAL npm tarball (#7065 class killer, WS1.2/T1).
 *
 * Three releases shipped a tarball that crashed on every boot (tls-options/3.8.41,
 * head-response-guard VPS #7040 + npm #7065) because no gate ever EXECUTED the
 * artifact: structure checks (check:pack-artifact) validate lists, not runtime.
 * This gate packs the tree, installs the tarball into a clean prefix, boots the
 * installed CLI and polls /api/monitoring/health until it proves the artifact
 * starts — regardless of WHICH packaging list drifted.
 *
 * Requires a built dist/ (run after `npm run build:cli`, e.g. in the CI
 * package-artifact job or `check:release-green --with-build`). Exit codes:
 * 0 = boots and reports the right version · 1 = boot failed · 2 = missing build.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const POLL_INTERVAL_MS = 2_000;
const BOOT_DEADLINE_MS = 240_000;

/**
 * Parse `npm pack --json` output into the generated tarball filename.
 *
 * Two robustness needs (CI, npm 12.2.0): (1) lifecycle output (prepare/husky)
 * can precede/follow the JSON payload in the captured stdout, so a raw
 * JSON.parse of the WHOLE string throws or lands on the wrong value; (2) npm
 * has shipped more than one payload shape — the wrapper `[{filename, files, …}]`
 * and a flatter object/array. We therefore extract the FIRST balanced JSON value
 * (string-aware bracket scan, same technique as validate-pack-artifact.ts) and
 * then read `filename` from whatever object carries it.
 */
/**
 * Pick the installed CLI's bin name from package.json's `bin` map.
 *
 * `bin` may be a string (single entry) or an object keyed by command name;
 * npm creates `prefix/bin/<key>` on install. Prefer the key that is NOT a
 * subcommand (skip "-"-containing keys like `…-reset-password`) so we get the
 * primary CLI, else the first entry. Throws when there is no bin at all — a
 * package that installs no CLI cannot be boot-smoked.
 */
export function resolveCliBinName(bin) {
  if (typeof bin === "string") return bin.split("/").pop();
  if (bin && typeof bin === "object") {
    const keys = Object.keys(bin);
    if (keys.length === 0) throw new Error("package.json bin map is empty");
    return keys.find((k) => !k.includes("-")) ?? keys[0];
  }
  throw new Error("package.json has no bin entry — nothing to boot");
}

export function pickTarball(packJsonOutput) {
  const parsed = extractFirstJson(packJsonOutput);
  const record = findFilenameRecord(parsed);
  if (!record?.filename) {
    // Self-diagnose: dump what npm ACTUALLY emitted (shape + preview) so the
    // next CI failure tells us the payload instead of repeating "no filename".
    const preview = String(packJsonOutput).slice(0, 500);
    const shape =
      parsed === null
        ? "null"
        : Array.isArray(parsed)
          ? `array[len=${parsed.length}]`
          : typeof parsed;
    const rec =
      parsed && !Array.isArray(parsed) && typeof parsed === "object"
        ? Object.keys(parsed).join(",")
        : "";
    throw new Error(
      `npm pack --json returned no filename. parsed=${shape}${rec ? ` keys=[${rec}]` : ""} len=${String(packJsonOutput).length} preview=${JSON.stringify(preview)}`
    );
  }
  // npm >=9 may emit scoped names with "/" — normalize to the on-disk file name.
  return record.filename.replace(/\//g, "-");
}

/** First balanced JSON value (array or object) in the output, string-aware. */
function extractFirstJson(output) {
  const startIdx = firstJsonStart(output);
  if (startIdx < 0) return null;
  const open = output[startIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = startIdx; i < output.length; i++) {
    const ch = output[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(output.slice(startIdx, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function firstJsonStart(s) {
  // Skip ANY leading non-JSON text (npm lifecycle output such as `npm notice …`
  // precedes the payload) and stop at the first array/object opener. We cannot
  // stop at the first non-whitespace char — that char is often the lifecycle
  // noise itself, which was the exact CI failure this scan exists to survive.
  const i = s.search(/[\[{]/);
  return i;
}

/**
 * Locate the record carrying `filename`. npm ships more than one top-level
 * shape for `pack --json`:
 *   - npm 11: `[{ filename, files, … }]`                     (array wrapper)
 *   - npm 12: `{ "<pkg-name>": { filename, … } }`            (object keyed by name)
 * so we probe every plausible place the record can live: the array's first
 * object-bearing element, the object itself, and each of the object's own
 * values (the npm-12 keyed form). Returns the first record that actually
 * carries a string `filename`, else null (→ caller throws, contract intact).
 */
function findFilenameRecord(parsed) {
  if (Array.isArray(parsed)) {
    for (const el of parsed) {
      if (el && typeof el === "object" && typeof el.filename === "string") return el;
    }
    return null;
  }
  if (parsed && typeof parsed === "object") {
    if (typeof parsed.filename === "string") return parsed;
    // npm 12 keyed form: descend into the value record(s).
    for (const val of Object.values(parsed)) {
      if (val && typeof val === "object" && typeof val.filename === "string") return val;
    }
  }
  return null;
}

/**
 * Boot verdict: HTTP 200 + a JSON body reporting the version we just packed.
 * `status` is logged but NOT asserted — a clean install with zero providers may
 * legitimately report degraded states; the gate targets boot crashes, not health.
 */
export function evaluateBoot(httpStatus, body, expectedVersion) {
  const failures = [];
  if (httpStatus !== 200) failures.push(`health HTTP ${httpStatus} (expected 200)`);
  if (!body || typeof body !== "object") failures.push("health body is not JSON");
  else if (body.version !== expectedVersion)
    failures.push(`version "${body.version}" (expected "${expectedVersion}")`);
  return { ok: failures.length === 0, failures };
}

/** Deterministic-enough free-ish port in a range CI runners don't use. */
export function pickPort(seed = process.pid) {
  return 23000 + (seed % 4000);
}

function log(msg) {
  console.log(`[pack-boot] ${msg}`);
}

async function main() {
  const ROOT = process.cwd();
  if (!fs.existsSync(path.join(ROOT, "dist", "server.js"))) {
    console.error(
      "[pack-boot] dist/server.js missing — run `npm run build:cli` first (this is a --with-build gate)"
    );
    process.exit(2);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const expectedVersion = pkg.version;
  // The installed CLI's symlink name is the `bin` MAP KEY (npm creates
  // prefix/bin/<key>), NOT a hardcoded brand. Reading it here — instead of the
  // legacy OmniRoute "omniroute" literal — is what makes this gate survive the
  // OmniRoute→astra-aigate rename: the source of truth is package.json's bin.
  const binName = resolveCliBinName(pkg.bin);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pack-boot-"));
  let child = null;
  let exitCode = 1;
  try {
    log(`packing v${expectedVersion}…`);
    const packOut = execFileSync("npm", ["pack", "--json", "--pack-destination", tmp], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const tarball = path.join(tmp, pickTarball(packOut));
    log(`installing ${path.basename(tarball)} into a clean prefix (postinstall runs for real)…`);
    const prefix = path.join(tmp, "prefix");
    execFileSync("npm", ["install", "-g", "--prefix", prefix, tarball], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });

    const port = pickPort();
    const dataDir = path.join(tmp, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const binPath = path.join(prefix, "bin", binName);
    log(`CLI bin resolves to prefix/bin/${binName} (from package.json bin)`);
    log(`booting installed CLI on :${port} (DATA_DIR isolated)…`);
    child = spawn(binPath, ["serve", "--port", String(port)], {
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
        JWT_SECRET: "pack-boot-smoke-secret-with-sufficient-length-000",
        API_KEY_SECRET: "pack-boot-smoke-api-key-secret-long",
        DISABLE_SQLITE_AUTO_BACKUP: "true",
        OMNIROUTE_SKIP_SYSTEM_TRUST: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const tail = [];
    const keepTail = (chunk) => {
      tail.push(String(chunk));
      while (tail.length > 80) tail.shift();
    };
    child.stdout.on("data", keepTail);
    child.stderr.on("data", keepTail);
    let childExit = null;
    child.on("exit", (code) => {
      childExit = code ?? -1;
    });

    const deadline = Date.now() + BOOT_DEADLINE_MS;
    let verdict = { ok: false, failures: ["never polled"] };
    while (Date.now() < deadline) {
      if (childExit !== null) {
        verdict = { ok: false, failures: [`process exited with code ${childExit} before serving`] };
        break;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/monitoring/health`);
        const body = await res.json().catch(() => null);
        verdict = evaluateBoot(res.status, body, expectedVersion);
        if (verdict.ok) {
          log(`healthy: HTTP 200, version ${body.version}, status "${body.status}"`);
          break;
        }
      } catch {
        // not listening yet — keep polling
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (verdict.ok) {
      log("✅ the packed tarball boots — #7065 class gate green");
      exitCode = 0;
    } else {
      console.error(`[pack-boot] ❌ boot FAILED: ${verdict.failures.join("; ")}`);
      console.error(
        "[pack-boot] last server output:\n" + tail.join("").split("\n").slice(-40).join("\n")
      );
      exitCode = 1;
    }
  } finally {
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 2_000));
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  main().catch((e) => {
    console.error("[pack-boot] fatal:", e.message);
    process.exit(1);
  });
}
