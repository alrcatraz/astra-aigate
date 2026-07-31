# Contributing to astra-aigate

Thank you for your interest in contributing to astra-aigate — the unified AI
service gateway. This guide covers the development workflow for this repository.

## Project Identity

- **Independent project** (not a GitHub fork), seeded from
  [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT)
- **Licence:** MIT
- **Language convention:** all user-facing content uses **British English**
  (`-ise`, `-our`, `-re`, `-ence`); locales live in `src/i18n/messages/`

## Development Environment

```bash
git clone <your-remote>/astra-aigate.git
cd astra-aigate
npm install
cp .env.example .env        # set INITIAL_PASSWORD, database paths, etc.
npm run dev                 # Next.js dev server (see scripts/dev/run-next.mjs)
```

### Build constraint (important)

- **NEVER run `next build` on HomeCentre01** — the 10.5K-file project with
  Expo + Tailwind OOMs the machine (network drops, forced reboot).
- Build on the dedicated build host (SUSETLearn00):
  `podman build --build-arg AIGATE_BUILD_MEMORY_MB=8192 -t localhost/astra-aigate:webpack-verify .`
- The Dockerfile forces webpack (`OMNIROUTE_USE_TURBOPACK=0`) — do not re-enable
  Turbopack without profiling memory usage first.

### i18n changes require a rebuild

`src/i18n/messages/*.json` are bundled at build time by next-intl. A key added
to `en.json` is NOT visible in a running container until the image is rebuilt
and redeployed.

## Code Conventions

- Frontend: React + TypeScript (`.tsx`), Expo design tokens — do not reintroduce
  Carbon components or custom style files
- Sidebar navigation is data-driven: edit
  `src/shared/constants/sidebarVisibility/sections.ts` only — never hard-code
  nav links in layouts
- Source is ESM (`.js`/`.mjs`); type annotations preferred in new TypeScript

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) with scopes:

| Prefix      | Purpose                      |
| ----------- | ---------------------------- |
| `feat:`     | new user-facing feature      |
| `fix:`      | bug fix                      |
| `refactor:` | behaviour-preserving change  |
| `docs:`     | documentation only           |
| `chore:`    | tooling, build, dependencies |
| `test:`     | test suite changes           |

Example: `fix(ui): sidebar collapse state lost on route change`

Commits are grouped by the fix or feature they implement — never by review
comment. All commits in this repository are GPG-signed.

## Verification

Before submitting changes:

```bash
npx tsc --noEmit            # type check
npx prettier --check src/   # formatting
BASE=http://host:20129 PASSWORD=xxx node scripts/test/regression-final.mjs
```

The regression suite covers: login i18n rendering, sidebar structure,
collapsible sub-groups, independent scrolling, scroll reset on route change,
redundant nav removal and locale switching.

## Pull Requests

1. Base your branch on `main` (fork the repo for external contributions)
2. Target `main` with your PR (release branches are internal only)
3. Include a screenshot for UI changes
4. Reference the PLAN.md phase your change belongs to, where applicable
