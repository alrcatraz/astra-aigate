# Changelog

All notable changes to **astra-aigate** are documented here.
Version line continues from the OmniRoute seed (v3.8.50).

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
