# astra-aigate — AI Agent Project Context

## Project Identity

- **Name:** astra-aigate
- **Repository:** `~/Projects/astra/astra-aigate/`
- **Identity:** Independent project (NOT a GitHub fork), seeded from
  [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT)
- **License:** MIT

## What It Does

Unified AI service gateway web console managing three categories:

1. **LLM Providers** — route /v1/chat/completions with combo fallback
2. **MCP Servers** — aggregate multiple MCP servers into one /mcp endpoint
3. **Auxiliary Services** — health monitoring + reverse proxy for Camofox,
   SearXNG, etc.

## Tech Stack

| Layer          | Choice                                                  |
| -------------- | ------------------------------------------------------- |
| Runtime        | Node.js 26 (container, trixie-slim)                     |
| Database       | SQLite via better-sqlite3                               |
| API framework  | Fastify (carried from OmniRoute)                        |
| MCP SDK        | @modelcontextprotocol/sdk (TypeScript)                  |
| Frontend       | Next.js 16 (App Router) + React 19 + Expo Design System |
| Auth           | Password + API keys (JWT)                               |
| Deployment     | Podman multi-stage standalone build                     |
| Frontend build | Next.js (webpack-only; Turbopack disabled)              |

## Source Code Origins

- `src/` — OmniRoute's complete source (v3.8.50), fully preserved
- LLM routing, provider/combo/API key management — from OmniRoute
- MCP aggregation — new, planned for Phase 3
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

- Remotes: `gitea` (private, git01.wrt.astra-lab.org) + `github` (public,
  alrcatraz/astra-aigate) — dual push
- Workflow: feature branches (`phase2-<topic>`) → PR → **rebase merge** to
  main → local sync `git pull --ff-only` (no force push after Phase 1)
- Version: standard SemVer; 0.x per completed phase (0.1.0 = Phase 1),
  1.0.0 = all PLAN phases done
- `alrcatraz` is the author; all commits GPG-signed

## Design Decisions

1. Independent project (not GitHub fork)
2. OmniRoute source fully preserved — only frontend is replaced
3. MCP uses `@modelcontextprotocol/sdk` directly, not MetaMCP
4. Non-MCP services (Camofox, SearXNG) use reverse proxy, not MCP wrapper
5. UI uses Next.js App Router + Carbon Design System (Expo shell superseded in Phase 1)
6. Podman container deployment; no standalone binary
7. MIT license

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

## Rename Strategy (OmniRoute → astra-aigate)

Three tiers, defined in PLAN.md §1.7:

| Tier       | Scope                                              | When       | Example                                                       |
| ---------- | -------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| **Tier 1** | Build-time env vars, Docker labels, binary names   | Phase 1.7  | `OMNIROUTE_BUILD_MEMORY_MB` → `AIGATE_BUILD_MEMORY_MB`        |
| **Tier 2** | Internal path aliases (`@omniroute/`)              | Phase 2.7  | `@omniroute/open-sse` → `@astra-aigate/open-sse`              |
| **Tier 3** | Source-code internals (types, functions, comments) | Never kept | `OmniRouteCombo`, `omniRouteFetch` etc. — provenance evidence |

Runtime env vars consumed by `open-sse/` source code (`OMNIROUTE_API_KEY`,
`OMNIROUTE_BASE_URL`, etc.) are **not renamed** — they're Tier 3 internal.

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
