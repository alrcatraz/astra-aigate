# astra-aigate — AI Agent Project Context

## Project Identity

- **Name:** astra-aigate
- **Repository:** `~/Projects/astra/astra-aigate/`
- **Identity:** Independent project (NOT a GitHub fork), seeded from
  [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT)
- **License:** MIT

## What It Does

Unified AI service gateway web console managing three categories:

1. **LLM Providers** — route /v1/chat/completions with combo fallback (290 in the catalog)
2. **MCP Servers** — MCP gateway host: one server exposing multiple MCP
   endpoints, registered self-hosted MCPs (local stdio + remote HTTP/SSE)
3. **Auxiliary Services** — health monitoring + reverse proxy for Camofox,
   SearXNG, etc.

UI ships **43 locales** (British English base, zh-CN, zh-TW, and 40 more).

## Tech Stack

| Layer          | Choice                                                    |
| -------------- | --------------------------------------------------------- |
| Runtime        | Node.js 26 (container, trixie-slim)                       |
| Database       | SQLite via better-sqlite3 (default) / PostgreSQL (opt-in) | SQLite = zero-ops default; `DB_DRIVER` switches to PG (Phase 2.8) |
| API framework  | Fastify (carried from OmniRoute)                          |
| MCP SDK        | @modelcontextprotocol/sdk (TypeScript)                    |
| Frontend       | Next.js 16 (App Router) + React 19 + Expo Design System   |
| Auth           | Password + API keys (JWT)                                 |
| Deployment     | Podman multi-stage standalone build                       |
| Frontend build | Next.js (webpack-only; Turbopack disabled)                |

## Source Code Origins

- `src/` — OmniRoute's complete source (v3.8.50), fully preserved
- LLM routing, provider/combo/API key management — from OmniRoute
- MCP gateway — Phase 3 (completed: registry + multi-endpoint + bridge + admin tools)
- Service monitoring — new, planned for Phase 4
- Expo Design System — Phase 1 (completed)

## File Conventions

- **PLAN.md** — development plan (architecture, phases, decisions)
- **AGENTS.md** — this file: project context for AI agents
- **DESIGN.md** — visual identity spec (Expo)
- Source in ESM (`.js`/`.mjs`)
- Frontend in `.tsx`/`.jsx` (Expo React + Expo tokens)
- Config in YAML

## Git & Versioning

- Remotes: `private` (private mirror) + `github` (public,
  alrcatraz/astra-aigate) — dual push
- Branch hierarchy (user-confirmed 2026-08-03): `feature/<type>-<desc>` →
  merge to **development** (dev branch) → development→main via **PR**
  (dual: private mirror + GitHub). **Never push directly to main; never push feature
  branches as deliverables; never have the build machine pull feature
  branches** (bypasses the PR review line). If development is missing at
  wrap-up, rebuild + dual-push it from main.
- Build machine pulls private-mirror main — symptom check: UI
  brand/feature mismatch with code = the changed branch was never merged
  to what the build machine pulls (or the build tree is stale), not "code
  not changed".
- Workflow: feature branches → PR → **rebase merge** to main → local sync
  `git pull --ff-only` (no force push after Phase 1)
- Version: standard SemVer; 0.x per completed phase (0.1.0 = Phase 1),
  1.0.0 = all PLAN phases done
- `alrcatraz` is the author; all commits GPG-signed

## Public-release Guard (2026-08-14)

**Before finalising ANY file that will reach a public remote, the agent must
decide whether the repository is dual-maintained, and scrub accordingly.**

Assessment (run on every release / public-facing change):

1. Does the maintainer run a **private/self-hosted Git forge** (any
   self-hosted hosting product) that mirrors this project?
2. Is that private host still an actively tracked remote for THIS repo
   (e.g. `git remote -v` lists it)?
3. If **both** are true → this repo IS dual-maintained (private + public).
   Then scrub every public-facing file (AGENTS.md, README, docs, CHANGELOG,
   any tracked .md) so it never names, describes, or hints at the private
   host: no self-host brand name, no self-host domain, no "dual push to
   private" phrasing, no build-machine hostnames or internal `.internal`
   suffixes. Refer to the private remote **only** as `private` / `private
mirror` / `internal remote`.
4. If either check is false (no private host, or not tracked here) → no
   scrubbing is needed for that aspect.

If scrubbing is required, the private remote's concrete name (brand +
host) is still used locally in `git remote -v`, but that name is
**never written into a tracked file**.

**Release checklist (every version bump):** after the version-bump commit
lands on development and is dual-pushed, complete ALL of:

1. **main merge** — merge development→main via PR on BOTH remotes; verify
   both `main` refs move. (A missed merge strands every later version —
   root cause of v0.5.2→v0.6.0 never reaching main.)
2. **tag** — `git tag -s vX.Y.Z -m "astra-aigate vX.Y.Z — <summary>"` ON the
   release commit (not a feature/merge node); push tags to BOTH remotes
   (`git push <public> --tags` + `git push <private> --tags`).
3. **release** — create the GitHub release (gh) AND the private-host release
   (API, Basic auth from pass store) for the same tag, bodies in sync.
4. **verify** — `git ls-remote --tags <public> <private>` lists the new tag
   on both; `gh release list` + private-host API show it. If any step is
   skipped, the version is NOT released.
   Recurring mistake to avoid: tags/releases created on development while
   `main` stays behind — keep the two release lines in lockstep.

## Design Decisions

1. Independent project (not GitHub fork)
2. OmniRoute source fully preserved — only frontend is replaced
3. MCP uses `@modelcontextprotocol/sdk` directly, not MetaMCP
4. Non-MCP services (Camofox, SearXNG) use reverse proxy, not MCP wrapper
5. UI uses Next.js App Router + Carbon Design System (Expo shell superseded in Phase 1)
6. Podman container deployment; no standalone binary
7. MIT license
8. Pluggable database (2.8): SQLite default (zero-ops), PostgreSQL opt-in via
   `DB_DRIVER=postgres` + `DATABASE_URL`; async `DatabaseAdapter` interface
   (sync SQLite drivers wrapped), dialect translation centralized in the PG
   adapter so business modules stay driver-agnostic. SQLite→PG migration:
   `scripts/migrate-sqlite-to-pg.ts` (idempotent, reconciles row counts).
   **PG-mode constraint (2026-08-06): all DB access must go through
   `getAsyncDb()`** — synchronous `getDbInstance()` falls back to an in-memory
   scratch DB in PG mode (reads empty, writes non-persistent). **Management
   migration is complete (Aug 2026):** all management modules (services,
   providers, key groups, evals, prompts, credit balance, gamification,
   analytics, cache, etc.) now use the async `DatabaseAdapter` and the 95-page
   dashboard surface is regression-tested green under `DB_DRIVER=postgres`
   (Playwright, 79/95 clean; the remainder are feature-not-open routes, 403/404,
   i18n warnings, or the separate-port live WebSocket — not code defects).
   Keep ALL new DB modules async-first; never add a synchronous `db.prepare()`
   call that returns a Promise consumed synchronously (`.map`/`for…of` on an
   un-awaited result is the recurring PG runtime failure mode).
   8a. **Chat pipeline integrity (2026-08-08): `translateRequest` must NEVER strip
   the conversation.** `applyThinkingBudget` (open-sse/translator/index.ts) had a
   production-runtime regression that reduced chat bodies to a bare `{model}`
   (upstream 400 `missing messages`) while reproducing as correct in every local
   form (real prod PG data, all thinking modes, compiled bundle). A HARDEN guard
   now falls back to the original body if the budget pass loses `messages`.
   Lesson: production-runtime-only regressions may be un-reproducible offline —
   isolate with per-transform probes + a real production request (see PLAN.md
   "v1 chat 丢失 messages" recap) rather than repeated local simulation.
9. MCP gateway (3.x): one server exposing MULTIPLE MCP endpoints (NOT a tool
   merge pool). Registry `mcp_servers` table; `kind` = pure connection
   semantics `builtin|stdio|http` (never a brand name). Preset group id
   `aigate-*` (long IDs avoid confusion): `aigate-omniroute` (Phase 1-2
   tools, `system=1`, enabled by default), `aigate-mcp` (Phase 3 mgmt
   tools), `aigate-infra` (Phase 4 placeholder, disabled). Preset entries
   are disable-able but NOT deletable. External endpoints:
   `/api/mcp/servers/[id]/{sse,stream}`; legacy `/api/mcp/sse` +
   `/api/mcp/stream` 301 → `aigate-omniroute`. Auth = OmniRoute API Key +
   scopes model generalised to AI Gate (no separate DMXAPI-style system
   token): endpoints accept EITHER admin session (requireManagementAuth)
   OR API Key Bearer + scope; registry writes need admin session or
   `write:mcp` scope, reads need `read:mcp`. Third-party service keys
   (camofox etc.) live encrypted in `auth_secret`, injected on forward —
   consumers configure only one AI Gate key. Marketplace installs: only a
   `source` field (`manual|marketplace`), no marketplace implementation.

## Registry & Config Conventions (Phase 2)

- **Capability = registry membership.** Media capabilities (embedding/rerank/
  tts/stt/image/...) are derived from `open-sse/config/*Registry.ts` via
  `mediaServiceKinds.ts`; adding a kind touches exactly 3 places
  (enum + i18n key + KIND_LABEL), pages are zero-change.
- **Registry entries are self-contained** (full endpoint URLs, own auth) —
  deliberately NOT ID-referenced (Option B, 2.3/2.4). New media entries MUST
  carry a typed `providerId: keyof typeof REGISTRY` link (compile-time
  existence check) + `satisfies` auth consistency with the provider def.
- **Ports/hostnames: single source only.** OmniRoute base URL must come from
  `src/shared/utils/resolveOmniRouteBaseUrl()` (env `OMNIROUTE_BASE_URL` →
  `DEFAULT_OMNIROUTE_BASE_URL`). Never write `localhost:20128` literals —
  exception: substring/heuristic checks (letta-settings, tool-detector) and
  example/doc strings.
- **Repeated timeouts → shared constants** in `open-sse/config/constants.ts`
  or `providers/shared.ts` (e.g. `DEFAULT_SEARCH_TIMEOUT_MS`), never inline.
- **modelSpecs.ts** is the single source for contextLength/maxOutputTokens;
  handlers must not hardcode model IDs (registry-driven).
- **Unverified ≠ registered**: a capability/endpoint only gets a registry
  entry after a live 200 probe (or authoritative docs).
- **Auth fields reference provider constants directly** (2.4): media registry
  entries import `SILICONFLOW_BASE`-style constants and the provider's own
  authType/authHeader rather than restating them — runtime drift is impossible;
  `satisfies ProviderLinked<P>` keeps the link compile-checked.
- **Dashboard auth checks reuse `isDashboardSessionAuthenticated`** (2.5):
  any route that needs to know "is a dashboard session present?" must call the
  shared guard (cookies + jwtVerify), never reimplement token parsing.
- **SSRF guard docs live in `docs/security/SSRF_GUARD.md`** (2.5): three
  switches (`OUTBOUND_SSRF_GUARD_ENABLED`, `OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS`,
  `OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS`); local-first default; cloud-metadata
  always blocked.
- **Quota config = `providers/usageConfigs.ts` single source** (2.7): every
  quota-capable provider MUST be declared there (`baseUrl?`, `endpoint`,
  `authMode`, `userHeaderName?`, `quotaPerCny?`, `needsSystemToken`,
  `displayMode`, `resetWindow?`) — never inline into catalog entries or
  duplicate in fetcher/UI. Two display modes: `balance` (remaining, pre-paid),
  `used-limit` (used/total + reset window; `usage-only` is the degraded
  fallback when no limit is available). `needsSystemToken: true` →
  `AgentrouterConsoleFields` renders the system admin-token field (reuses the
  generic `consoleApiKey` + `newApiUserId` fields, same as agentrouter #6850).
  Dispatch lives in `open-sse/services/usage.ts` (switch on provider id →
  `open-sse/services/usage/*.ts` fetcher leaves); adding a provider touches
  exactly: usageConfigs.ts + usage.ts case + `USAGE_SUPPORTED_PROVIDERS`.

## Rename Strategy (OmniRoute → astra-aigate)

Three tiers, defined in PLAN.md §1.7:

| Tier       | Scope                                              | When       | Example                                                       |
| ---------- | -------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| **Tier 1** | Build-time env vars, Docker labels, binary names   | Phase 1.7  | `OMNIROUTE_BUILD_MEMORY_MB` → `AIGATE_BUILD_MEMORY_MB`        |
| **Tier 2** | Internal path aliases (`@omniroute/`)              | Phase 2.7  | `@omniroute/open-sse` → `@astra-aigate/open-sse`              |
| **Tier 3** | Source-code internals (types, functions, comments) | Never kept | `OmniRouteCombo`, `omniRouteFetch` etc. — provenance evidence |

Runtime env vars consumed by `open-sse/` source code (`OMNIROUTE_API_KEY`,
`OMNIROUTE_BASE_URL`, etc.) are **not renamed** — they're Tier 3 internal.

**Deploy-chain exception (Tier 1-complete as of C7):** env vars that travel the
deploy chain — compose files, Dockerfile `ARG`/`ENV`, container entry scripts
(`scripts/docker/*`), and the build/dev scripts that read them — MUST use the
new `AIGATE_*` names. This set is exactly: `AIGATE_BASE_PATH` /
`NEXT_PUBLIC_AIGATE_BASE_PATH`, `AIGATE_USE_TURBOPACK`, and
`NEXT_PUBLIC_AIGATE_E2E_MODE`. Anything a deployer can set in
`docker-compose.yml`, `.env`, or `docker run -e` that still reads
`OMNIROUTE_*` is a bug (see `check-env-doc-sync`).

**Host-network deployment (2026-08-08):** astra-aigate 现用 `--network host`
（容器共享宿主栈，替代 pasta + `-p 20128:20128`；为访问宿主 3001/3002/3003
MCP 服务 + SearXNG/Camofox）。关键运维约束（均被生产踩坑）：

- `--env-file` 只在 `podman run`（创建）时读取，**`podman restart` 不重读** → 改
  `~/aigate-env-keep.env` 后必须 `rm + run` 重建。
- host 网络下 `DATABASE_URL` 用 `127.0.0.1:55432`（非 `host.containers.internal`）；
  astra-pg `*:55432` 监听，pg_hba `127.0.0.1/32 trust` + `all all scram`——容器来源
  非回环走 scram，密码必须正确。
- ⚠️ **禁止用 patch/脱敏编辑含密码的 env 值**（会变 `***` 破坏密码）→ 用
  execute_code + 从备份恢复；改 env 后重建容器。

## Container Image Hygiene (2026-08-20)

**Background.** rootless Podman keeps images/layers in
`~/.local/share/containers/storage/`. Building a new version and tagging it
does NOT free the previous tag — if old tags are not removed, the image
history fills the disk (the host once hit 100% full with 1.6G left). This is
the most common disk problem in this project's container build loop. The same
discipline applies to any container-image project built with Podman.

**Habit — after EVERY successful build of a new version:**

1. Confirm the running/production container is on the **new** tag, then delete
   the old tag(s):
   ```bash
   podman images                            # list current tags + sizes
   podman rmi <image>:<old-version-tag>     # delete each obsolete tag one by one
   ```
   Keep only tags a running container references, plus one or two recent
   versions as rollback insurance (how many is a user decision).
2. Prune dangling images: `podman image prune -f`
3. Multi-tag deletion often surfaces **new** `<none>` images (shared parent
   layers exposed by the removed tags). Re-run `podman image prune -f` until
   `podman images` shows a stable dangling set — a single pass is NOT enough.

**Full-disk diagnosis checklist** (when the disk reports full):

```bash
df -h /                                     # which mount is full
du -xhd1 ~/<user> | sort -rh | head        # locate the big user-dir blocks
podman images | sort                        # image inventory
podman image prune -f                       # clear dangling
```

The largest recoverable space is almost always `~/.local/share/containers/
storage` (old image history).

**Pitfalls (verified):**

- Most dangling `<none>` images are **shared layers** (referenced by a running
  container or as a parent of another image). Direct `podman rmi` fails and
  `podman image prune -f` only removes what is safe — **do not force-delete
  them**. They are usually not independent physical space (overlay de-dups
  layers), so `df` may not grow from their removal.
- **`podman images` Size is virtual** (includes parent layers). Physical disk
  use is the de-duplicated overlay space, so the apparent sum of image sizes
  is roughly double the real footprint — do not size recovery proposals off
  that field.
- `.cache` (uv/pip/npm) and `/tmp` are secondary recovery sources; they have
  real value when disk is extremely full.
- **Never touch production data layers.** Layers under
  `containers/storage/overlay` that are referenced by a running container
  (this project's production image data) must not be deleted.

## CLAUDE.md

Deliberately removed. This project uses standard AGENTS.md only
(CLAUDE.md is CLAUDE Code–specific and not applicable here).

## Working Directory

```
~/Projects/astra/astra-aigate/
├── src/            ← Source code (OmniRoute + new)
├── config/         ← Default configs
├── docs/           ← Architecture docs
├── references/     ← Reference material
├── scripts/        ← Build/dev scripts
├── DESIGN.md       ← Visual identity spec
├── Dockerfile      ← Podman build
├── PLAN.md
├── AGENTS.md
├── FUNDING.yml
├── LICENSE
└── README.md
```
