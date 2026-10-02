// guix-native-probe.mjs — does the DECLARATIVE toolchain actually run this
// repo's native modules?
//
// Motivation: the lockfile carries 19 packages with install scripts; the
// unit tests load better-sqlite3 + sqlite-vec (native .node / .so), and
// tsx drives everything through an esbuild binary. If those all work under
// `guix shell` on the pinned node, the build/test jobs can migrate to the
// shared action; if they do not, the failure here is the exact data the
// migration decision needs.
//
// Run INSIDE the guix wrapper ($GUIX_SHELL node scripts/guix-native-probe.mjs)
// so process.version IS the pinned toolchain's node.
//
// Advisory by design: the job that runs this has continue-on-error, and the
// exit code marks FAIL lines — it reports, it never gates a merge.

import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";

const require = createRequire(import.meta.url);

const results = [];

async function probe(name, critical, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: String(detail ?? "ok"), critical });
  } catch (err) {
    results.push({
      name,
      ok: false,
      detail: String(err?.message ?? err)
        .split("\n")[0]
        .slice(0, 160),
      critical,
    });
  }
}

await probe("node runtime", true, () => {
  const v = process.versions;
  return `v${v.node} napi=${v.napi} modules=${v.modules} ${process.platform}/${process.arch}`;
});

await probe("better-sqlite3", true, () => {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  const row = db.prepare("select sqlite_version() as v").get();
  db.close();
  return `sqlite ${row.v}`;
});

// Mirrors src/lib/memory/vectorStore.ts exactly: sqliteVec.load(db) on the
// raw better-sqlite3 handle, then a vec0 virtual table round-trip.
await probe("sqlite-vec (load + vec0 table)", true, () => {
  const Database = require("better-sqlite3");
  const sqliteVec = require("sqlite-vec");
  const db = new Database(":memory:");
  sqliteVec.load(db);
  db.exec("create virtual table vec_probe using vec0(embedding float[4])");
  db.prepare("insert into vec_probe(embedding) values (?)").run(
    new Float32Array([0.1, 0.2, 0.3, 0.4])
  );
  const n = db.prepare("select count(*) as n from vec_probe").get().n;
  db.close();
  return `vec0 rows=${n}`;
});

await probe("onnxruntime-node", false, () => {
  const ort = require("onnxruntime-node");
  return ort.version ? `ort ${ort.version}` : "loaded";
});

await probe("tsx (test runner)", true, () => require.resolve("tsx"));

await probe("esbuild (tsx backing)", false, () => {
  const esbuild = require("esbuild");
  return esbuild.version ? `esbuild ${esbuild.version}` : "loaded";
});

await probe("keytar (optional)", false, () => require.resolve("keytar"));
await probe("libxmljs2 (optional)", false, () => require.resolve("libxmljs2"));
await probe("koffi (optional)", false, () => require.resolve("koffi"));

// Report: stdout for the log, step summary for the human.
const lines = results.map(
  (r) => `${r.ok ? "OK  " : "FAIL"} ${r.name}${r.critical ? "" : " (non-critical)"} — ${r.detail}`
);
console.log("=== guix native probe (pinned toolchain) ===");
for (const l of lines) console.log(l);

try {
  const summary = "### Guix native-module probe\n\n```\n" + lines.join("\n") + "\n```\n";
  appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? "/dev/null", summary);
} catch {
  /* summary is best-effort */
}

const failedCritical = results.filter((r) => !r.ok && r.critical);
if (failedCritical.length > 0) {
  console.error(
    `FATAL: ${failedCritical.length} critical binding(s) failed under the pinned toolchain`
  );
  process.exit(1);
}
console.log("all critical bindings OK");
