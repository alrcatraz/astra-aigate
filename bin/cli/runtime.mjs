import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { apiFetch, isServerUp } from "./api.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export class ServerOfflineError extends Error {
  constructor(message = "Server is offline and operation requires HTTP runtime") {
    super(message);
    this.name = "ServerOfflineError";
    this.exitCode = 3;
  }
}

function makeHttpContext(opts) {
  return {
    kind: "http",
    api: (path, fetchOpts = {}) => apiFetch(path, { ...opts, ...fetchOpts }),
    baseUrl: opts.baseUrl,
  };
}

async function importDbModules() {
  const [combos, recovery] = await Promise.all([
    import(`${PROJECT_ROOT}/src/lib/db/combos.ts`),
    import(`${PROJECT_ROOT}/src/lib/db/recovery.ts`),
  ]);
  return { combos, recovery };
}

async function makeDbContext() {
  const modules = await importDbModules();
  // The versioned migration runner is kicked off lazily — and asynchronously —
  // by the first getDbInstance()/getAsyncDb() call. DB-mode CLI commands must
  // join that barrier before their first query, otherwise they read a
  // half-migrated schema (e.g. `combos` without `context_cache_protection`,
  // added by migrations 005/096) and fail with SQLITE_ERROR on a fresh
  // DATA_DIR. Same barrier-join shape as the test harnesses.
  const core = await import(`${PROJECT_ROOT}/src/lib/db/core.ts`);
  core.getDbInstance();
  await core.awaitDbMigrations();
  return { kind: "db", db: modules };
}

export async function withRuntime(fn, opts = {}) {
  const requireServer = opts.requireServer === true;
  const preferDb = opts.preferDb === true;

  if (!preferDb) {
    const up = await isServerUp(opts);
    if (up) {
      return await fn(makeHttpContext(opts));
    }
    if (requireServer) {
      throw new ServerOfflineError();
    }
  }

  return fn(await makeDbContext());
}

export async function withHttp(fn, opts = {}) {
  const up = await isServerUp(opts);
  if (!up) throw new ServerOfflineError();
  return fn(makeHttpContext(opts));
}

export async function withDb(fn) {
  return fn(await makeDbContext());
}
