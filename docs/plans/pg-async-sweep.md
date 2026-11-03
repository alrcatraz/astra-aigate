# PHASE 1 — Eliminate the remaining synchronous DB paths (PG mode)

Status: IN PROGRESS · Owner: Angelia (orchestrator) · Executors: dispatched per task
Repo: /home/alrcatraz/Projects/astra/astra-aigate · Branch: e.g. `fix/pg-async-sweep` off `development`

## Why this exists

The 0.6.2 release introduced the async DB adapter (`getAsyncDb()`), but a number of modules
were never migrated. In PG mode they fall back to `getDbInstance()`, which returns an
**in-memory SQLite scratch** and logs:

    [DB] WARNING: synchronous SQLite path used in PG mode (module not yet async-migrated).
    Data written here is scratch-only and will NOT persist.

Measured 2026-11-02 on the deployed 0.6.10 container: **18,270 occurrences** since boot
(~9 h). Two consequences, both observed:

1. **Data loss risk** — writes through those paths (e.g. `model_intelligence`) land in the
   scratch DB and never reach Postgres.
2. **Latency** — `getTaskFitnessWithSource()` queried the DB up to 4× per candidate, with
   misses never cached. A 169-candidate auto-combo therefore did ~676 synchronous lookups
   per request: measured 8.9 s between "virtual combo created" and the first attempt,
   and 9.8–19.5 s end-to-end for `auto/best-fast`.

## Debt inventory (measured, non-test)

    getDbInstance() call sites: 66 across 21 files
    `.raw` casts (same anti-pattern): 21

Excluding `core.ts` internals (25), adapter type files (2) and `postgresAdapter.ts` (1),
the application debt is **~38 sites in 18 files**:

| Cluster                     | Files                                                                                                                           | Sites |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Hot path — logging          | `src/lib/proxyLogger.ts`                                                                                                        | 4     |
| Hot path — limits/quota     | `db/providers/rateLimit.ts` (4), `db/tokenLimits.ts` (3), `db/tierConfig.ts` (3), `open-sse/services/tokenLimitCounter.ts` (3)  | 13    |
| Hot path — caches/telemetry | `semanticCache.ts` (2), `db/quotaSnapshots.ts` (2), `db/optimizationSettingsTracker.ts` (2), `db/compressionAnalytics.ts` (2)   | 8     |
| Hot path — core tables      | `db/middleware.ts` (2), `db/apiKeys.ts` (1)                                                                                     | 3     |
| Startup / admin             | `instrumentation-node.ts` (3), `usage/migrations.ts` (1), `usage/apiKeySelfService.ts` (1)                                      | 5     |
| API routes                  | `api/db-backups/{export,exportAll}/route.ts` (3), `api/db-backups/import/route.ts` (1), `api/settings/import-json/route.ts` (1) | 5     |

## Design rules for every task

1. **Async adapter only.** `const db = getAsyncDb() as unknown as DatabaseAdapter;` then
   `await db.prepare(sql).get/all/run(...)`. No `(adapter as SqliteAdapter).raw`, no
   `sqlite_master` probes (SQLite-only).
2. **No new N+1.** If a function is called per candidate/row, load once and cache (snapshot
   with TTL + invalidation on write), never query per item.
3. **Keep synchronous callers synchronous** where the call chain is sync (e.g. scoring
   strategies). Load the data asynchronously at an async entry point, or refresh on a timer;
   do not force an async ripple through strategy interfaces.
4. **Transactions** go through `db.immediate(fn)` — the adapter owns BEGIN/COMMIT and the
   PG equivalent.
5. **No behaviour change** beyond the storage path: same SQL semantics, same return shapes,
   same fallbacks when a table is absent.
6. Every task ends with: `npx tsc --noEmit -p tsconfig.typecheck-core.json` and
   `node scripts/check/check-dashboard-typecheck.mjs` clean, plus the tests it touches.

## Tasks

**T1 — model_intelligence + fitness snapshot (IN PROGRESS, base already written)**
Files: `src/lib/db/modelIntelligence.ts`, `open-sse/services/autoCombo/taskFitness.ts`,
`src/sse/handlers/autoRouting.ts`, `src/lib/arenaEloSync.ts`.
Done: all 8 module functions async via the adapter; `bulkUpsert` uses `db.immediate()`;
taskFitness loads a snapshot (`ensureFitnessSnapshot()`, 60 s TTL, `startFitnessSnapshotRefresh()`);
`model_capabilities` moved into the same snapshot (its `sqlite_master` probe removed);
auto-routing awaits the snapshot before creating the virtual combo.
Remaining: two vitest cases fail (`autoCombo.test.ts` › `-free alias resolution`) because the
test seeds `model_intelligence` directly and then expects a synchronous read; it must
`await ensureFitnessSnapshot(true)` after seeding (and after `invalidateFitnessCache()`).
Acceptance: `npm run test:vitest` 293/293; the two tests updated, not skipped.

**T2 — proxy logger** (`src/lib/proxyLogger.ts`, 4 sites)
Fire-and-forget writes today; keep them off the request path (`void` + catch) but through
the async adapter. Acceptance: proxy logging still produces rows in PG mode; no unhandled
rejections.

**T3 — limits/quota cluster** (`rateLimit.ts`, `tokenLimits.ts`, `tierConfig.ts`,
`tokenLimitCounter.ts`; 13 sites)
These are read on every request. Add a small read-through cache where the table is hot;
writes stay immediate. Acceptance: unit tests for the limit modules + one integration path
that consumes a token limit.

**T4 — caches/telemetry** (`semanticCache.ts`, `quotaSnapshots.ts`,
`optimizationSettingsTracker.ts`, `compressionAnalytics.ts`; 8 sites)
Acceptance: their existing tests pass; no sync warnings from these modules.

**T5 — core tables** (`db/middleware.ts`, `db/apiKeys.ts`; 3 sites)
Acceptance: auth/key paths unaffected; API key tests pass.

**T6 — startup/admin/API routes** (`instrumentation-node.ts`, `usage/migrations.ts`,
`usage/apiKeySelfService.ts`, `api/db-backups/*`, `api/settings/import-json`; 10 sites)
These already run in request handlers (async) — straightforward awaits.
Acceptance: backup export/import round-trip works against PG.

**T7 — final sweep + proof**

- `grep -rn 'getDbInstance(' src open-sse | grep -v core.ts | grep -v adapters/` → only
  intentional, documented uses (if any) remain.
- Run the server in PG mode for 10 minutes under the auto-combo load; assert the warning
  count does not increase (`grep -c 'synchronous SQLite path' before/after`).
- Full matrix: typecheck, dashboard typecheck, lint, file-size, vitest, unit shards,
  integration — green.

## Execution rules (multi-agent)

- One task per executor; each gets this document plus its file list and the design rules.
- Builds/tests that are CPU-heavy run on **SL00**, not HC01.
- Executor returns: files changed, commands run, real output, and anything it could not do.
- The orchestrator (me) verifies independently before anything is committed: re-run the
  typecheck/tests, inspect the diff for rule violations (raw casts, new sync calls, N+1).
- Signed commits: only after verification, from SL00 (Iris) via A2A, with the repo-local
  identity `alrcatraz <alrcatraz@gmx.com>` and GPG signing.

## Out of scope

- The 7 remaining high advisories (upstream-only, inside promptfoo).
- "one node everywhere" in container CI (executor-image work).
- Refactors unrelated to the sync→async migration.
