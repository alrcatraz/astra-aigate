# Changelog

All notable changes to **astra-aigate** are documented here.
Version line continues from the OmniRoute seed (v3.8.50).

## [0.5.1] — Cross-provider context fixes + chat admission relaxation (2026-08-10)

Bug-fix release: combo targets whose context length was unknown were silently
dropped for large-context requests; new model steps defaulted to weight 0 and
were never selected by weighted routing; and the chat body admission limiter
rejected legitimate high-tool-count coding traffic with retryable 503s.

### Fixed

- Model context resolution for resellers: `deepseek-v4-flash-0731` is now a spec
  alias of `deepseek-v4-flash` (1M context), so any provider serving it (e.g.
  dmxapi-cn) resolves the correct context window instead of being excluded by
  large-context request compatibility filtering.
- Glm model context sync: models.dev `glm` provider map now includes zhipu/zhipuai,
  so zhipu/glm-* combo targets gain their context window from the automatic sync.
- Local model context override for the bundled llamacpp Ternary-Bonsai model (8192).
- New model steps (manual, batch, string-form, and combo references) now default
  to weight 1 so weighted routing selects them immediately; existing weight-0
  rows were backfilled in production.
- Chat admission (`chatBodyAdmission.ts`): raised the heavy-request tool threshold
  from 64 to 400 and the heavy in-flight capacity from 1 to 3, so normal
  high-tool-count coding traffic no longer exhausts the single heavy slot and
  evicts ordinary large-body requests with a 503.

### Changed

- Version bump to 0.5.1.

## [0.5.0] — Skill Hub + routing fixes (2026-08-09)

Skill Hub (M0-M5): multi-source skill aggregation with sources, artifacts,
and navigation. Routing fixes for manual model weight and PG bootstrap.

### Added

- **Skill Hub**: multi-source skill aggregation — pull skills from git repos
  (tarball), SSH hosts, or built-in catalogs; register sources, discover and
  install skills, package dependency-aware artifacts for AI agents
  (`48be66a0`)
- Skill sources dashboard page + `/api/skills` sources/artifacts routes +
  DB migration 138 (`skill_sources`)
- Data-driven sidebar order: LLM → Skill → MCP → services (`sections.ts`,
  `types.ts` registration fix for `skill-sources`)
- `docs/reference/WS_TROUBLESHOOTING.md` — WebSocket failure runbook
  (loopback bind vs LAN exposure, Origin allow-list 4003, missing-token 4001,
  why curl's 101 is not proof of a healthy connection) (`21121f44`)

### Fixed

- `fix(combos)`: manual/batch model additions defaulted `weight: 0` — the
  weighted strategy never selected them. Now `weight: 1` (`8e12f1d2`)
- `fix(db)`: `featureFlags.syncAll` awaited instead of fire-and-forget; PG
  bootstrap waits for connectivity with clearer failures; regex fix for the
  doubled-backslash schema match (`79fc6667`)

### Chore

- Privacy scrub: internal device names and LAN IPs replaced with neutral
  examples across docs, CLI, tests, migration seed data (`37ddc271`)
- `.gitignore` ignores auto-generated SQLite backups (`86f8d225`)
- Version bump 0.5.0

### 验证

- typecheck clean (sections.ts/types.ts zero errors); smoke 18/18 (historical)
- v102 production deploy verified: Skill Hub pages 200, WS Origin allow-list
  (LAN/domain allowed, evil.com 4003), migrations 136/137/138 applied

---

## [0.4.4] — PG 模式收敛 + 空对象修复 (2026-08-09)

Phase 2 (Provider Access Layer) 修复收敛：PostgreSQL 模式下媒体提供商列表、combo
构建、WebSocket 绑定、权限同步的四类问题全数修复，并定位/修复媒体模型列表空对象的系统性根因。

### Fixed

- **WS 绑定**: `fix(ws)` — 绑定 0.0.0.0 时自动接受 loopback/LAN origin（`cb63c2e6`，Combo Studio「实时已禁用」）
- **模型静默丢失（Systematic Async bug）**: `fix(catalog)` — `getModelIsHidden` 等 13 处 async 检查未 await，导致 provider 模型被静默 drop（`f01b25d5`）
- **同型 async bug**: `fix(authz)` — key 权限与别名同步的 hidden 检查未 await（`4dea8ca1`）；`fix(combo)` — combo builder 的 hidden/capability 查询未 await（`03b91cda`）；`fix(models)` — persisting synced models 的 deleted 检查未 await（`01af7d05`）
- **空对象根因（最关键）**: `fix(catalog)` — `catalogResponse.ts` 的 `enrichCatalogModelEntry`（async）在 `array.map` 里未 await，被序列化成 `{}`，导致 `/v1/providers/{id}/models` 的 `owned_by` filter 得 0、媒体页 embedding 只显示一种（`4640345d`）。修复后 `/v1/models` 1361 模型 0 空对象，硅基流动 embedding 全显（含 bge-m3）
- **媒体 UI 同步**: `fix(media)` — provider detail/card 的 service-kind UI 与 media registries 对齐（`ca6a5002`）

### Chore

- 版本 bump 0.4.4（`f51e0c30`）

### 验证

- 本机回归: PG 模式 `/v1/models`=1361 全非空、combo 48 个、WS 0.0.0.0:20132、searxng/camofox up
- 双端推送（gitea + github）+ tag `v0.4.4`

---

## [Unreleased]

### Added

- Data-driven sidebar: `sections.ts` is the single source of truth for navigation
- Collapsible sub-groups in the sidebar (`Routing & Access`, `Combos`) with per-group toggle state
- Independent scrolling layout: fixed-height container, sidebar-internal scroll, main-content scroll reset on route change
- 22 new i18n keys across en/zh-CN/zh-TW (section titles, group titles, collapse labels); `auth.signingIn` backfilled
- Playwright regression suite (`scripts/test/regression-final.mjs`, 17 assertions)
- `Dockerfile.slim` for pre-built standalone deployment

### Changed

- Branding: user-facing default app name is now "Astra AI Gate" (was "OmniRoute" in 8 hard-coded places); "OmniRoute" remains only as the provider-logic identifier (`custom:OmniRoute` prefix)
- Sidebar section renamed OmniProxy → OmniRoute
- `en.json` fully converted to British English (`-ise`, `-our`, `-re`, `-ence`); filename stays `en.json`
- Contrast fixes: muted-button text, disabled-state opacity floor, sidebar inactive items

### Removed

- 6 redundant nav items (pure redirect stubs or placeholder jumps): Auto Combo, Compression group entry, MITM Proxy, 1Proxy, Limits, Settings Pricing (routes kept for old bookmarks)
- Dead code: `Header.tsx` + orphaned `TokenHealthBadge.tsx` / `DegradationBadge.tsx` (zero imports project-wide)

---

## [3.8.50] — Phase 1 complete (2026-07-31)

Initial bootstrap and Phase 1 (Foundation: Expo Shell + Branding + UI Polish).

### Added

- Project bootstrap from OmniRoute seed (`a5f447e`) — full source preserved, independent identity
- `DESIGN.md` — IBM Carbon design system spec, later superseded by Expo (see below)
- `Dockerfile` multi-stage build (webpack-only, `OMNIROUTE_USE_TURBOPACK=0`)
- Stub directories for MCP, services and lib
- Self-hosted IBM Plex fonts, Carbon palette, onboarding flow

### Changed

- Carbon Design System shell replaced by **Expo design language** (luminous monochrome, pure-black #000000 primary actions) — `1d29e38`
- Fonts: Inter + JetBrains Mono (`d85d2ea`)
- Dev phases restructured in `PLAN.md` (`eff98b7`)

### Fixed

- Carbon components wrapped in client boundary; CSS import (`0d74fac`)
- DESIGN.md colors/fonts/onboarding — self-hosted fonts, proper spacing (`e47de0e`)
- Tier-1 branding cleanup: removed `CLAUDE.md`, renamed build-time env vars, binary, container labels (`eede327`)
