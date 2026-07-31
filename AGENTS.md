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

- Remote: `gitea` (private) → when ready: `public` (GitHub)
- Version: 3-layer SemVer: `Z.alrcatraz.Y.angelia.Z`
- `alrcatraz` is the author

## Design Decisions

1. Independent project (not GitHub fork)
2. OmniRoute source fully preserved — only frontend is replaced
3. MCP uses `@modelcontextprotocol/sdk` directly, not MetaMCP
4. Non-MCP services (Camofox, SearXNG) use reverse proxy, not MCP wrapper
5. UI uses Expo Design System
6. Podman container deployment; no standalone binary
7. MIT license

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
