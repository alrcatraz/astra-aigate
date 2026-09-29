#!/usr/bin/env node
// scripts/check/check-test-db-invariants.mjs
// Gate — invariantes estruturais de teste de DB (evita recaída da dívida corrigida
// em PR #40: sync reset sem barrier de migration).
//
// WHY: a auditoria 2026-09-28 encontrou 783 arquivos / 1276 chamadas de
// `resetDbInstance()` (SÍNCRONA, não espera migration). Em CI isso virava
// `SqliteError: no such table` — cada teste recriava o DB enquanto outra
// transação ainda lia. A correção em massa (scripts .tmp-fix/apply-v2.ts)
// trocou por `await core.resetDbInstanceDrained()` + barreira
// (`getDbInstance(); await awaitDbMigrations()`). Sem gate, um arquivo NOVO que
// reintroduza o padrão antigo passaria despercebido até a próxima falha em CI.
//
// Implementação via TypeScript AST (o MESMO parser da correção), para que gate e
// corretor não divirjam na noção de "escopo dono" e "teardown".
//
// Invariantes (as duas que causaram a falha de CI de PR #40):
//  (I1) Nenhuma chamada `resetDbInstance(` (sync) em tests/ — canônico é
//       `await core.resetDbInstanceDrained()`.
//  (I2) Toda chamada `resetDbInstanceDrained()` em escopo de SETUP deve ter barreira
//       (`getDbInstance()` + `await awaitDbMigrations()`) na MESMA função dona.
//       Teardown (after/afterEach/teardown/cleanup/restore, e blocos try/catch de
//       cleanup) fica ISENTO: barreira ali recriaria o DB depois do rmSync.
//
// POR QUE NÃO HÁ CHECAGEM DE missing-await AQUI: detecção estática de "chamada a
// função async sem await" exige resolução de tipos/import completa (o resultado
// pode ser sync por sobrecarga, re-export, ou wrapper); regex e AST sem type-checker
// produzem alto falso-positivo (construtores, `fs.mkdtempSync`, `.map()` etc).
// Além disso missing-await NÃO falha CI de PR #40 (CI reporta `no such table`,
// não `Promise pending`) — ele só aparece localmente depois que a camada de
// reset (I1/I2) está corrigida. A dívida de missing-await foi corrigida em massa
// pelo .tmp-fix/apply-await.ts e é garantida por typecheck + revisão.
//
// Dívida pré-existente congela em config/quality/test-db-invariants-baseline.json
// (débito visível, decrescente). NOVO ofensor → fail. Entrada do baseline que deixou
// de ser ofensor → fail pedindo remoção (stale-allowlist enforcement).
// `--update` regrava o baseline (use só para REMOVER corrigidos; NUNCA congelar dívida
// nova — adição nova deve ser corrigida, é o ponto do gate).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = process.cwd();
const TESTS_DIR = path.join(ROOT, "tests");
const BASELINE_PATH = path.resolve(
  process.argv.includes("--baseline")
    ? process.argv[process.argv.indexOf("--baseline") + 1]
    : path.join(ROOT, "config/quality/test-db-invariants-baseline.json")
);
const UPDATE = process.argv.includes("--update");

const WALK_EXCLUDE = new Set(["node_modules", ".next", "dist", "coverage", ".git"]);
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|mjs)$/;
const TEARDOWN_RE = /^(after|afterEach|teardown|cleanup|restore)$/i;

// ── fs helpers ───────────────────────────────────────────────────────────────
function walk(dir, out = [], matchRe = TEST_FILE_RE) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (WALK_EXCLUDE.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, matchRe);
    else if (matchRe.test(e.name)) out.push(p);
  }
  return out;
}
function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}
function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  return {
    text,
    src: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  };
}
function isFn(n) {
  return (
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n)
  );
}

// ── I1: sync resetDbInstance( ────────────────────────────────────────────────
export function findSyncResetCalls(src) {
  const hits = [];
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText();
      // cobre `resetDbInstance(` e a variante opcional `resetDbInstance?.(`
      if (
        /(^|[^A-Za-z0-9_])resetDbInstance$/.test(callee) &&
        !/resetDbInstanceDrained$/.test(callee)
      ) {
        hits.push(n.getStart());
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return hits;
}

// ── I2: Drained sem barrier no mesmo escopo dono ────────────────────────────
// Espelha apply-v2 Pass C: acha o call Drained, sobe até a função dona (nearest
// enclosing fn), isenta teardown, e exige `awaitDbMigrations(` no corpo dessa função.
export function findDrainedWithoutBarrier(src, text) {
  const owners = [];
  const collect = (n) => {
    if (ts.isCallExpression(n) && /resetDbInstanceDrained$/.test(n.expression.getText())) {
      let fn = n;
      while (fn && !isFn(fn)) fn = fn.parent;
      if (fn) owners.push(fn);
    }
    ts.forEachChild(n, collect);
  };
  collect(src);

  const offenders = [];
  for (const fn of new Set(owners)) {
    // teardown?
    let inTeardown = false;
    let p = fn;
    while (p) {
      if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
        const call = p.parent;
        if (call && ts.isCallExpression(call)) {
          const name = call.expression.getText().replace(/^.*\./, "");
          if (TEARDOWN_RE.test(name)) {
            inTeardown = true;
            break;
          }
        }
      }
      p = p.parent;
    }
    if (inTeardown) continue;
    const body = fn.body;
    if (!body) continue;
    const bodyText = text.slice(body.getStart(), body.getEnd());
    if (bodyText.includes("awaitDbMigrations(")) continue;
    offenders.push(fn.getStart());
  }
  return offenders;
}

// ── baseline ────────────────────────────────────────────────────────────────
function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { files: [] };
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return { files: [] };
  }
}
function saveBaseline(files) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({ files }, null, 2) + "\n");
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const testFiles = walk(TESTS_DIR);

  const perFile = new Map();
  for (const f of testFiles) {
    let text, src;
    try {
      ({ text, src } = parse(f));
    } catch {
      continue;
    }
    const i1 = findSyncResetCalls(src);
    const i2 = findDrainedWithoutBarrier(src, text);
    if (i1.length || i2.length) perFile.set(rel(f), { i1, i2 });
  }

  const offendersNow = [...perFile.keys()].sort();
  const baseline = loadBaseline();
  const baselineSet = new Set(baseline.files || []);

  if (UPDATE) {
    saveBaseline(offendersNow);
    console.log(
      `[check-test-db-invariants] baseline atualizado: ${offendersNow.length} arquivo(s) em ${path.relative(ROOT, BASELINE_PATH)}`
    );
    return;
  }

  const fresh = offendersNow.filter((f) => !baselineSet.has(f));
  const stale = [...baselineSet].filter((f) => !perFile.has(f));
  const failures = [];

  if (fresh.length) {
    const detail = fresh
      .slice(0, 50)
      .map((f) => {
        const v = perFile.get(f);
        const parts = [];
        if (v.i1.length) parts.push(`${v.i1.length}× resetDbInstance() sync`);
        if (v.i2.length) parts.push(`${v.i2.length}× Drained sem barrier`);
        return `  ✗ ${f}  (${parts.join(", ")})`;
      })
      .join("\n");
    failures.push(
      `[invariantes] ${fresh.length} arquivo(s) NOVO(s) viola(m) os invariantes de teste de DB:\n` +
        detail +
        `\n  → I1: use \`await core.resetDbInstanceDrained()\`, nunca \`resetDbInstance()\`.` +
        `\n  → I2: após Drained em escopo de setup, chame \`core.getDbInstance(); await core.awaitDbMigrations();\` (teardown isento).` +
        (fresh.length > 50 ? `\n  … e mais ${fresh.length - 50} (rode o gate localmente)` : "")
    );
  }
  if (stale.length) {
    failures.push(
      `[stale-allowlist] ${stale.length} entrada(s) do baseline deixaram de ser ofensor(a)s — remova com \`--update\`:\n` +
        stale.map((f) => `  ✗ ${f}`).join("\n")
    );
  }

  if (failures.length) {
    console.error(`[check-test-db-invariants] FALHOU:\n\n` + failures.join("\n\n"));
    process.exitCode = 1;
    return;
  }
  console.log(
    `[check-test-db-invariants] OK (${testFiles.length} arquivos de teste; ${baselineSet.size} congelado(s) no baseline; invariantes I1 sync-reset, I2 barrier)`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
