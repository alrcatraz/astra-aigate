# astra-aigate — Development Plan

## Vision

**astra-aigate** is a unified AI service gateway and management console.
One web UI to configure, monitor, and route three categories of services:

1. **LLM Providers** — provider management, combo routing, fallback (OmniRoute core)
2. **MCP Servers** — MCP server registration, tool aggregation, connectivity checks
3. **Auxiliary Services** — health monitoring and reverse proxy for non-MCP tools
   (Camofox, SearXNG, etc.)

Originally seeded from [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT),
it evolves into an independent project with additional MCP aggregation and service
management capabilities.

---

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │          astra-aigate                │
                    │         (:20128, Podman)             │
                    │                                      │
  Clients ──────────┤  ┌───────────────────────────────┐  │
  (Hermes, Chatbox, │  │  HTTP Router                  │  │
   curl, etc.)      │  │  path → module dispatch        │  │
                    │  └──┬──┬──────────┬────────┬──────┘  │
                    │     │  │          │        │         │
                    │  ┌──┴──┴──┐  ┌────┴────┐ ┌┴────────┐│
                    │  │  LLM   │  │   MCP   │ │Services ││
                    │  │ Engine │  │  Engine │ │Monitor  ││
                    │  │(route, │  │(aggreg. │ │(health, ││
                    │  │ fallbk)│  │ ping)   │ │ proxy)  ││
                    │  └───┬────┘  └────┬────┘ └────┬───┘│
                    │      │            │            │    │
                    └──────┼────────────┼────────────┼────┘
                           │            │            │
                    ┌──────┴──┐  ┌──────┴──────┐  ┌──┴─────────┐
                    │ DeepSeek │  │ codegraph   │  │ Camofox    │
                    │ GLM      │  │ markitdown  │  │ SearXNG    │
                    │ Bonsai   │  │ time/zotero │  │ (future)   │
                    │ ...      │  │ astra-kb    │  │            │
                    └─────────┘  │ pageindex   │  └────────────┘
                                 │ godot ...   │
                                 └─────────────┘
```

### Data Layer

```
SQLite (astra-aigate.db) — single file, zero-ops
├── providers        ← LLM provider configs (from OmniRoute)
├── combos           ← routing combo chains (from OmniRoute)
├── api_keys         ← API key management (from OmniRoute)
├── call_logs        ← LLM invocation logs (from OmniRoute)
├── mcp_servers      ← MCP server registrations (new)
│   ├── name, type (stdio/sse), command/url, enabled
│   ├── last_ping, last_tools_list (cached)
├── services         ← auxiliary service registry (new)
│   ├── name, url, type, health_endpoint
│   └── health_logs  ← timestamped ping results
└── settings         ← app-wide settings
```

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | **Node.js 24** | OmniRoute base; MCP TS SDK native |
| API Framework | **Fastify / Express** | Carry forward OmniRoute's pattern |
| Database | **SQLite** via better-sqlite3 | Zero-ops, same as OmniRoute, Podman volume |
| MCP SDK | **@modelcontextprotocol/sdk** (TypeScript) | Official SDK, Streamable HTTP support |
| Frontend | **React + IBM Carbon Design System** | Professional look, accessible, active maintenance |
| Auth | **JWT + API Keys** | Carry forward OmniRoute's auth model |
| Deployment | **Podman multi-stage build** | Alpine-based Node image ≈200MB |
| License | **MIT** | Matches OmniRoute + MCP SDK |

---

## Module Breakdown

### A. LLM Engine (`src/llm/`)
- Provider management (add/test/remove)
- Combo routing (default → fallback → last resort)
- Format translation (any → OpenAI-compatible)
- Call logging + token counting
- **Source:** migrated from OmniRoute with minimal restructuring

### B. MCP Engine (`src/mcp/`)
- MCP server lifecycle: add, connect, disconnect, reconnect
- Tool aggregation: polls `tools/list` from each backend, merges
- Connectivity check: periodic `ping` / `tools/list` heartbeat
- Single MCP endpoint: exposes all tools as one `/mcp` gateway
- **New development**, using `@modelcontextprotocol/sdk` Client class

### C. Service Monitor (`src/services/`)
- Service registry: name, URL, type, health check endpoint
- Health checker: periodic HTTP ping (configurable interval)
- Reverse proxy: path-based routing to backend URLs
- Health history: last N results stored in SQLite
- **New development**

### D. UI (`src/ui/`)
- **Login / Auth** — carry forward from OmniRoute, reskinned with Carbon
- **LLM Dashboard** — provider list, combo config, call logs, API keys
- **MCP Manager** — server list, tool preview, connectivity status, add/edit form
- **Service Monitor** — service overview, health indicators, proxy config
- **Carbon Design System** — `@carbon/react` as component library

### E. Reverse Proxy (`src/proxy/`)
- Path-based routing: `browser/*` → Camofox, `search/*` → SearXNG
- Simple pass-through, no SSL termination (handled by Caddy if needed)
- Configurable via Services registry in DB

---

## Development Phases

### Phase 1: Foundation — LLM Gateway + Carbon UI

**Objective:** Independent `astra-aigate` repo running OmniRoute's full LLM
functionality with a Carbon-based management UI.

**Strategy:** OmniRoute source is fully imported and preserved. The only
functional change in Phase 1 is replacing the frontend. Backend (LLM routing,
provider/combo management, API keys, call logs) stays untouched.

**Estimated:** 3–4 days (non-consecutive)

#### 1.1 — Initialize Independent Repository

- [ ] Clone OmniRoute upstream to a temp directory
- [ ] Create `astra-aigate` repo: `git init`, `git checkout --orphan astra-root`
- [ ] Copy all OmniRoute source files into the astra-aigate working tree
- [ ] Rename project: update `package.json` (name → `astra-aigate`, description)
- [ ] Write `MIT LICENSE` with original OmniRoute copyright preserved
- [ ] Write `.gitignore` (Node + node_modules + dist + .env + *.db)
- [ ] First commit: `chore: initial project bootstrap from OmniRoute`
- [ ] Set up Gitea remote (`git01.wrt.astra-lab.org:alrcatraz/astra-aigate`)
- [ ] Push to Gitea (private)
- **Check:** `git log --oneline` shows clean single-commit history

#### 1.2 — Restructure to Modular Layout

- [ ] Move OmniRoute source into `src/llm/` tree:
  ```text
  src/
  ├── llm/           ← All original OmniRoute source (unchanged)
  │   ├── backend/   ← Node.js server, API, middleware, auth
  │   └── ui/        ← Original React frontend (to be replaced in 1.4)
  ├── mcp/           ← Stub directory for Phase 2
  ├── services/      ← Stub directory for Phase 3
  └── lib/           ← Shared utilities
  ```
- [ ] Update entry point paths in `package.json` and startup script
- [ ] Verify `npm run dev` still starts successfully
- **Check:** `curl 127.0.0.1:20128/api/health` returns 200

#### 1.3 — Write DESIGN.md

- [ ] Load `skill_view("popular-web-designs", "templates/ibm.md")` as reference
- [ ] Write `DESIGN.md` with Google's DESIGN.md spec format:
  - Colors: Carbon palette (Blue 60 `#0f62fe`, Gray 100 `#161616`, etc.)
  - Typography: IBM Plex Sans + IBM Plex Mono, full type scale
  - Components: buttons, inputs, cards, nav, tags styled per Carbon
  - Tokens: `--cds-*` prefixed CSS custom properties
- [ ] Validate with `npx -y @google/design.md lint DESIGN.md`
- **Check:** `lint` passes with no errors

#### 1.4 — Replace UI with Carbon Design System

*Note: Most complex step in Phase 1.*

- [ ] Install `@carbon/react`, `@carbon/themes`, and deps in `src/llm/ui/`
- [ ] Wrap the app in Carbon's `Theme` provider
- [ ] Replace login page: build with Carbon `TextInput`, `Button`, structured layout
- [ ] Replace dashboard shell: Carbon `SideNav` (3-section stub navigation),
      `Header`, `Content` layout
- [ ] Migrate existing pages (providers, combos, API keys, logs) one by one:
  - Replace arbitrary table → Carbon `DataTable`
  - Replace arbitrary form → Carbon `Form` + `TextInput` + `Select` + `Button`
  - Replace arbitrary buttons → Carbon `Button` (primary/secondary/ghost/danger)
- [ ] Apply Carbon tokens: 0px border-radius, bottom-border inputs, Gray 10 cards
- [ ] Test UI navigation: login → dashboard → each section page loads
- **Check:** UI matches Carbon spec (sharp corners, IBM Plex, Blue 60 accent)

#### 1.5 — Podman Containerisation

- [ ] Write multi-stage `Dockerfile`:
  ```dockerfile
  # Stage 1 — build frontend
  FROM node:24-alpine AS builder
  WORKDIR /app
  COPY src/llm/ui/package*.json ./
  RUN npm ci
  COPY src/llm/ui/ .
  RUN npm run build

  # Stage 2 — build backend
  FROM node:24-alpine
  WORKDIR /app
  COPY src/llm/backend/package*.json ./
  RUN npm ci --production
  COPY src/llm/backend/ .
  COPY --from=builder /app/dist ./public
  EXPOSE 20128
  VOLUME /app/data
  CMD ["node", "server.js"]
  ```
- [ ] Write `.dockerignore` (node_modules, .git, src, dev files)
- [ ] `podman build -t astra-aigate .`
- [ ] `podman run -d -p 20128:20128 -v astra-aigate-data:/app/data astra-aigate`
- **Check:** container starts, `curl /api/health` returns 200, UI loads in browser

#### 1.6 — Sanity Verification

- [ ] LLM routing: add a test provider via API, send `/v1/chat/completions`, verify response
- [ ] Call logs: make an LLM call, verify log appears in dashboard
- [ ] API key management: create/revoke keys, test auth
- [ ] Combo routing: set fallback chain, test failure mode
- [ ] UI: login → navigate all sections → logout works
- [ ] GPG sign the commit
- [ ] Push to Gitea
- **Deliverable:** Working LLM gateway with Carbon UI on :20128

### Phase 2: MCP Engine
- [ ] Implement MCP server registry in SQLite
- [ ] Implement MCP client using `@modelcontextprotocol/sdk`
- [ ] Tool aggregation: connect → `tools/list` → merge
- [ ] Expose unified `/mcp` endpoint
- [ ] Add MCP server management in UI (add/edit/remove, status indicator)
- **Deliverable:** MCP aggregation working, manageable via UI

### Phase 3: Services Monitor
- [ ] Implement service registry in SQLite
- [ ] Implement health checker (scheduled pings)
- [ ] Implement reverse proxy (path routing)
- [ ] Add service monitor UI (list, status LED, health history)
- [ ] Register Camofox + SearXNG as default services
- **Deliverable:** All three sections operational

### Phase 4: Polish & Release
- [ ] Enhanced call logging (MCP + service calls)
- [ ] Error notification in UI
- [ ] Configuration export/import
- [ ] GitHub README, LICENSE, CI
- [ ] Public Gitea release → GitHub public
- **Deliverable:** v1.0.0 release

---

## Directory Structure (Proposed)

```
astra-aigate/
├── src/
│   ├── main.js              ← Entry point
│   ├── llm/                 ← LLM routing (from OmniRoute)
│   │   ├── router.js
│   │   ├── providers.js
│   │   └── combos.js
│   ├── mcp/                 ← MCP aggregation (new)
│   │   ├── engine.js        ← MCP client manager
│   │   ├── registry.js      ← DB CRUD
│   │   └── gateway.js       ← Unified MCP endpoint
│   ├── services/            ← Service monitor (new)
│   │   ├── monitor.js       ← Health checker
│   │   ├── registry.js      ← DB CRUD
│   │   └── proxy.js         ← Reverse proxy
│   ├── api/                 ← REST API (extended from OmniRoute)
│   │   ├── routes/
│   │   │   ├── providers.js
│   │   │   ├── combos.js
│   │   │   ├── keys.js
│   │   │   ├── mcp.js        ← new
│   │   │   └── services.js   ← new
│   │   ├── auth.js
│   │   └── middleware.js
│   ├── db/                  ← Database layer
│   │   ├── schema.js
│   │   ├── migrations/
│   │   └── seed.js
│   ├── ui/                  ← React frontend (Carbon)
│   │   ├── src/
│   │   │   ├── App.jsx
│   │   │   ├── pages/
│   │   │   │   ├── Login.jsx
│   │   │   │   ├── Dashboard.jsx
│   │   │   │   ├── LLMProviders.jsx
│   │   │   │   ├── MCPServers.jsx       ← new
│   │   │   │   └── ServiceMonitor.jsx   ← new
│   │   │   ├── components/
│   │   │   └── layouts/
│   │   ├── package.json
│   │   └── vite.config.js
│   └── lib/                 ← Shared utilities
│       ├── logger.js
│       └── config.js
├── config/
│   ├── default.yaml
│   └── production.yaml
├── scripts/
│   └── build.sh
├── Dockerfile
├── package.json
├── .github/
│   └── FUNDING.yml         ← Sponsorship links
├── AGENTS.md
├── PLAN.md
├── LICENSE
└── README.md
```

---

## Sponsorship

`astra-aigate` accepts sponsorships via GitHub Sponsors
(and optionally Buy Me a Coffee / Ko-fi / Open Collective).

Sponsor links are configured in `.github/FUNDING.yml`, auto-detected by
GitHub to show a "Sponsor" button on the repo page.

**Current status:** Not actively seeking sponsors. The link exists so that
anyone who finds the project useful can choose to support it.

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-30 | Independent project (not GitHub fork) | 80%+ new code; no upstream PR path needed |
| 2026-07-30 | Name: `astra-aigate` | AI Gate — unified entry for all AI services |
| 2026-07-30 | UI: IBM Carbon Design System | Professional, maintainable, distinct from OmniRoute |
| 2026-07-30 | MCP: `@modelcontextprotocol/sdk` directly | More control than MetaMCP; Node.js native |
| 2026-07-30 | Deployment: Podman multi-stage | Node.js can't produce clean musl binary |
| 2026-07-30 | License: MIT | Matches upstream, zero friction |
|| 2026-07-30 | Non-MCP services: reverse proxy only | No MCP wrapper for Camofox/SearXNG in V1 |
|| 2026-07-30 | Sponsorship via `.github/FUNDING.yml` | GitHub auto-detects for Sponsor button; ready when needed |
