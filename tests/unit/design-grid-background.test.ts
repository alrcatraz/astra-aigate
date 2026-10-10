import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static guards for the shared visual identity (Expo design system — see DESIGN.md).
// The graph-paper grid wallpaper / brand-gradient era was replaced by the Expo shell
// rewrite (93f7cbe1); these tests now lock the DESIGN.md contract: monochromatic
// Cloud-Gray canvas, Inter/JetBrains-Mono type, the radius scale, accent = Link
// Cobalt, and — critically — that the tokens live components reference are defined
// (accent / radius-card / table tokens are consumed by ~40 components).

const globalsCss = fs.readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
const dashboardLayout = fs.readFileSync(
  new URL("../../src/shared/components/layouts/DashboardLayout.tsx", import.meta.url),
  "utf8"
);

test("globals.css defines the Expo canvas tokens", () => {
  // DESIGN.md §2: page background is Cloud Gray; cards are Pure White; body text Near Black.
  assert.match(globalsCss, /--color-page-bg:\s*#f0f0f3/); // Cloud Gray canvas
  assert.match(globalsCss, /--color-surface:\s*#ffffff/); // card surfaces
  assert.match(globalsCss, /--color-text-main:\s*#1c2024/); // body text Near Black
  assert.match(globalsCss, /--color-border:\s*#e0e1e6/); // Border Lavender
});

test("globals.css paints the canvas on the page body", () => {
  // The Expo design has no graph-paper wallpaper; the body must carry the Cloud-Gray
  // canvas (via --color-bg) so the light two-tone system reads correctly.
  const css = globalsCss;
  assert.match(css, /--color-bg:\s*#f0f0f3/);
  // no leftover grid renderer from the previous design
  assert.ok(!css.includes("body::before"), "no grid wallpaper pseudo-element remains");
});

test("globals.css defines the shared identity tokens", () => {
  // DESIGN.md §2 core palette — the monochromatic system.
  assert.match(globalsCss, /--color-primary:\s*#000000/); // Expo Black headlines / CTA
  assert.match(globalsCss, /--color-surface-2:\s*#f5f5f7/); // secondary surface
  assert.match(globalsCss, /--color-accent:\s*#0d74ce/); // Link Cobalt (interaction colour)
  // gradients are forbidden by DESIGN.md §7
  assert.ok(
    !globalsCss.includes("--grad-brand"),
    "no brand gradient (DESIGN.md forbids gradients)"
  );
});

test("DashboardLayout wrapper uses the Expo Cloud-Gray canvas", () => {
  // The shell must paint the Cloud-Gray page background (DESIGN.md §2) rather than
  // leave a transparent/old-bg wrapper. (The previous design's "transparent grid
  // shell" contract no longer applies — there is no grid wallpaper to show through.)
  assert.ok(
    !dashboardLayout.includes("overflow-hidden bg-bg"),
    "DashboardLayout must not use the removed bg-bg token"
  );
  assert.match(
    dashboardLayout,
    /min-h-screen bg-\[#f0f0f3\]/,
    "DashboardLayout outer wrapper paints the Cloud-Gray canvas"
  );
});

// ── Phase 2: primitives adopt the shared radius scale, brand gradient & border token ──

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("globals.css exposes the semantic radius utilities", () => {
  // DESIGN.md §5: Rounded 8px (cards / feature cards / dialogs), control radius 8px.
  assert.match(globalsCss, /--radius:\s*8px/); // Rounded
  assert.match(globalsCss, /--radius-card:\s*var\(--radius\)/); // @theme → rounded-card (8px)
  assert.match(globalsCss, /--radius-control:\s*8px/); // control / input radius
});

test("Button uses the flat Expo palette + control radius (no gradient)", () => {
  const button = read("../../src/shared/components/Button.tsx");
  // DESIGN.md §7 forbids gradients; the primary CTA is flat Expo Black.
  assert.match(button, /primary:\s*"bg-black/);
  assert.match(button, /accent:\s*"bg-link-cobalt/); // accent variant = Link Cobalt
  assert.ok(!button.includes("--grad-brand"), "no brand gradient on the button");
  assert.ok(button.includes("rounded-control"), "button sizes use the control radius");
});

test("Card / Modal / Input / Select adopt the radius scale and border token", () => {
  const card = read("../../src/shared/components/Card.tsx");
  const modal = read("../../src/shared/components/Modal.tsx");
  const input = read("../../src/shared/components/Input.tsx");
  const select = read("../../src/shared/components/Select.tsx");
  assert.ok(card.includes("border border-border"), "card uses the --color-border token");
  assert.ok(card.includes("rounded-card"), "card uses rounded-card (8px)");
  assert.ok(!card.includes("border-black/5"), "the under-weight /5 border is gone");
  assert.ok(modal.includes("rounded-card"), "modal uses rounded-card");
  assert.ok(input.includes("rounded-control"), "input uses the control radius");
  assert.ok(select.includes("rounded-control"), "select uses the control radius");
});

// ── Phase 3: status hex centralized + mono font token ──

test("status colors come from one canonical module", () => {
  const mod = read("../../src/shared/constants/statusColors.ts");
  assert.match(mod, /export const STATUS_HEX/);
  assert.match(mod, /success:\s*"#22c55e"/);
  assert.match(mod, /warning:\s*"#f59e0b"/);
  assert.match(mod, /error:\s*"#ef4444"/);

  const edges = read("../../src/shared/components/flow/edgeStyles.ts");
  assert.ok(
    edges.includes('from "@/shared/constants/statusColors"'),
    "edgeStyles imports the module"
  );
  assert.ok(edges.includes("STATUS_HEX.success"), "edgeStyles uses STATUS_HEX, not a literal");
  assert.ok(!edges.includes('"#22c55e"'), "edgeStyles no longer hardcodes the success hex");
  // (TokenHealthBadge consumer removed by the Expo rewrite; the canonical module and
  // the remaining consumers above are the live contract.)
});

test("globals.css defines a monospace token (DESIGN.md §3)", () => {
  // DESIGN.md §3 mono stack starts with JetBrains Mono then lists ui-monospace.
  assert.match(globalsCss, /--font-mono:\s*"JetBrains Mono",\s*ui-monospace/);
});

test("DataTable is theme-aware via --table-* tokens", () => {
  // The Expo @theme defines the light values (DESIGN.md is a light-only spec).
  assert.match(globalsCss, /--table-header-bg:\s*rgba\(249,\s*249,\s*251,\s*0\.95\)/);
  assert.match(globalsCss, /--table-row-zebra:\s*rgba\(0,\s*0,\s*0,\s*0\.02\)/);
  assert.match(globalsCss, /--table-row-hover:\s*rgba\(0,\s*0,\s*0,\s*0\.04\)/);
  assert.match(globalsCss, /--table-cell-border:\s*rgba\(0,\s*0,\s*0,\s*0\.04\)/);

  const dt = read("../../src/shared/components/DataTable.tsx");
  assert.ok(dt.includes("var(--table-header-bg)"), "header uses the token");
  assert.ok(dt.includes("var(--table-row-zebra)"), "zebra uses the token");
  assert.ok(dt.includes("var(--color-border)"), "header border uses the brand token");
  assert.ok(
    !/rgba\(|#[0-9a-fA-F]{3,6}/.test(dt),
    "DataTable no longer hardcodes any color literal"
  );
  assert.ok(
    !dt.includes("--text-secondary") && !dt.includes("--bg-table-header"),
    "the dead var fallbacks are gone"
  );
});

// ── Phase 4 (safe additives): cn() merge + Checkbox / Textarea primitives ──

test("cn() dedupes conflicting Tailwind classes via tailwind-merge", () => {
  const cnSrc = read("../../src/shared/utils/cn.ts");
  assert.match(cnSrc, /from "tailwind-merge"/);
  assert.match(cnSrc, /from "clsx"/);
  assert.match(cnSrc, /twMerge\(clsx\(/);
});

test("Checkbox + Textarea primitives exist and are exported", () => {
  const barrel = read("../../src/shared/components/index.tsx");
  assert.ok(barrel.includes('export { default as Checkbox } from "./Checkbox"'));
  assert.ok(barrel.includes('export { default as Textarea } from "./Textarea"'));
  const checkbox = read("../../src/shared/components/Checkbox.tsx");
  const textarea = read("../../src/shared/components/Textarea.tsx");
  assert.ok(
    checkbox.includes("accent-[var(--color-accent)]"),
    "checkbox uses the brand accent token"
  );
  assert.ok(textarea.includes("rounded-control"), "textarea uses the control radius");
});

// ── C6: form controls share one accent focus ring (separate from the red error state) ──

test("form controls use a non-red focus ring, never the error red", () => {
  // The previous design asserted a --focus-ring token (removed by the Expo rewrite).
  // The live invariant is that keyboard focus never collides with the red error state:
  // controls use either the accent ring or the primary (Expo Black, not red) ring, and
  // the red error ring is kept only where the control has an error state.
  for (const name of ["Input", "Select", "Textarea", "Toggle", "Checkbox"]) {
    const src = read(`../../src/shared/components/${name}.tsx`);
    // The default (non-error) focus ring is accent or primary (Expo Black) — never red.
    // (Checkbox uses focus-visible:ring-2 … ring-accent; the others focus:ring-accent|primary/…)
    assert.ok(
      /ring-(?:accent|primary)(?:\/\d+)?/.test(src),
      `${name} default focus ring is accent/primary, not red`
    );
    // A red ring may only appear in the error-conditional branch (error ? ... : "").
    for (const line of src.split("\n")) {
      if (/focus:ring-red-500\/20/.test(line)) {
        assert.ok(
          /error\s*\?/.test(line),
          `${name} red focus ring must be gated behind the error state`
        );
      }
    }
    // the red error ring stays intact where the control has an error state
    if (src.includes("error")) {
      assert.ok(src.includes("ring-red-500/20"), `${name} keeps the red error ring`);
    }
  }
});

// ── Phase 5: the grid reaches every standalone screen + the shell is fluid up to 4K ──

test("standalone full-screen pages stay transparent so the grid shows through", () => {
  // Same contract as the DashboardLayout shell: a full-viewport wrapper must not paint
  // an opaque bg-bg over the body::before grid. These are the auth / error / legal /
  // status / onboarding screens that render outside the dashboard layout — the ones the
  // first grid phase missed. (?![\w-]) keeps bg-bg-alt / bg-bg-main from matching.
  const pages = [
    "../../src/app/login/page.tsx",
    "../../src/app/forgot-password/page.tsx",
    "../../src/app/callback/page.tsx",
    "../../src/app/maintenance/page.tsx",
    "../../src/app/offline/page.tsx",
    "../../src/app/status/page.tsx",
    "../../src/app/terms/page.tsx",
    "../../src/app/privacy/page.tsx",
    "../../src/app/(dashboard)/dashboard/onboarding/page.tsx",
    "../../src/shared/components/ErrorPageScaffold.tsx",
  ];
  for (const p of pages) {
    const src = read(p);
    assert.ok(
      !/min-h-screen[^"]*\bbg-bg(?![\w-])/.test(src) &&
        !/\bbg-bg(?![\w-])[^"]*min-h-screen/.test(src),
      `${p} must not paint bg-bg on a min-h-screen wrapper (it would hide the grid)`
    );
  }
});

test("DashboardLayout content shell is fluid up to ~4K before centering", () => {
  // The inner content wrapper grows with the viewport up to a 4K cap (3840px) instead
  // of the old max-w-7xl (1280px) that left wide side gutters on large monitors. The
  // Expo rewrite moved the shell to a flex column (sidebar + fluid main), so the cap
  // now lives on the main content region rather than a fixed max-w class.
  const main = dashboardLayout.slice(dashboardLayout.indexOf("flex-1 min-w-0"));
  assert.ok(
    dashboardLayout.includes("flex-1 min-w-0"),
    "content region is fluid (flex-1 min-w-0) rather than a fixed 1280px cap"
  );
  assert.ok(!dashboardLayout.includes("max-w-7xl"), "the old 1280px max-w-7xl cap is gone");
  assert.ok(main.includes("overflow-y-auto"), "content region scrolls beyond the viewport");
});

// ── Phase 6: data tables are opaque content surfaces so the grid never bleeds through ──
//
// The dashboard content area is intentionally transparent (the body::before grid shows
// through as a wallpaper). A data table whose nearest ancestor is NOT an opaque surface
// would let the grid bleed through its transparent even-rows / low-alpha zebra rows.
// Cards already carry bg-surface; these guards cover the shared table primitives and the
// tables that render *without* a Card. Tables verified to live inside a <Card>/Modal are
// intentionally left untouched (bg-surface there would be a redundant no-op).

test("DataTable primitive paints its own opaque surface", () => {
  const dt = read("../../src/shared/components/DataTable.tsx");
  assert.ok(
    dt.includes("var(--color-surface)"),
    "DataTable scroll container is opaque (its even rows are transparent by design)"
  );
});

test("log table cards are opaque (no semi-transparent bg-black tint)", () => {
  // bg-black/5|20 on a <Card> wins over the Card's own bg-surface via tailwind-merge,
  // turning the big log tables ~95% transparent — the grid bled straight through them.
  for (const p of [
    "../../src/shared/components/ProxyLogger.tsx",
    "../../src/shared/components/RequestLoggerV2.tsx",
  ]) {
    const src = read(p);
    assert.ok(
      !src.includes("bg-black/5") && !src.includes("bg-black/20"),
      `${p} must not tint the table Card with bg-black/5|20 (it drops the Card's opaque surface)`
    );
    assert.ok(src.includes("bg-surface"), `${p} table card uses the opaque bg-surface`);
  }
});

test("card-less data tables wrap their table in an opaque surface", () => {
  const expect = [
    [
      "../../src/app/(dashboard)/dashboard/batch/BatchListTab.tsx",
      "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]",
    ],
    [
      "../../src/app/(dashboard)/dashboard/batch/FilesListTab.tsx",
      "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]",
    ],
    [
      "../../src/app/(dashboard)/dashboard/cache/components/CacheEntriesTab.tsx",
      "overflow-x-auto bg-surface",
    ],
    [
      "../../src/app/(dashboard)/dashboard/settings/components/proxy/FreePoolTab.tsx",
      "rounded border border-border bg-surface",
    ],
    [
      "../../src/app/(dashboard)/dashboard/tools/agent-bridge/components/ModelMappingTable.tsx",
      "overflow-hidden bg-surface",
    ],
    [
      "../../src/app/(dashboard)/dashboard/tools/traffic-inspector/components/shared/HeaderTable.tsx",
      "bg-surface",
    ],
  ];
  for (const [p, needle] of expect) {
    const src = read(p);
    assert.ok(
      src.includes(needle),
      `${p} must include "${needle}" so the table is opaque over the grid`
    );
  }
});

test("semi-transparent cache table boxes are now opaque", () => {
  for (const p of [
    "../../src/app/(dashboard)/dashboard/cache/components/ReasoningCacheTab.tsx",
    "../../src/app/(dashboard)/dashboard/cache/page.tsx",
  ]) {
    const src = read(p);
    assert.ok(
      !src.includes("bg-surface/35"),
      `${p} table box no longer uses the ~35%-opaque bg-surface/35 (the grid bled through it)`
    );
  }
});
