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

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 24 |
| Database | SQLite via better-sqlite3 |
| API framework | Fastify (carried from OmniRoute) |
| MCP SDK | @modelcontextprotocol/sdk (TypeScript) |
| Frontend | React + IBM Carbon Design System |
| Auth | JWT + API Keys |
| Deployment | Podman multi-stage build |
| Frontend build | Vite |

## Source Code Origins

- `src/` — OmniRoute's complete source (v3.8.50), fully preserved
- LLM routing, provider/combo/API key management — from OmniRoute
- MCP aggregation — new, planned for Phase 2
- Service monitoring — new, planned for Phase 3
- UI replacement with Carbon Design System — Phase 1

## File Conventions

- **PLAN.md** — development plan (architecture, phases, decisions)
- **AGENTS.md** — this file: project context for AI agents
- **DESIGN.md** — visual identity spec (IBM Carbon)
- Source in ESM (`.js`/`.mjs`)
- Frontend in `.tsx`/`.jsx` (React + Carbon)
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
5. UI uses IBM Carbon Design System (`@carbon/react`)
6. Podman container deployment; no standalone binary
7. MIT license

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
