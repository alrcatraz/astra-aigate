/**
 * RTL layout regression test — #3541 (partial, core layout)
 *
 * For RTL locales (ar/fa/he/ur) the sidebar and key overlays must flip
 * correctly when `dir=rtl` is set on <html>.  Tailwind v4 supports logical
 * direction utilities natively (`start-*`, `end-*`, `ps-*`, `pe-*`, `ms-*`,
 * `me-*`, `text-start`, `text-end`) which auto-mirror under dir=rtl without
 * extra `rtl:` variants.
 *
 * This test reads the source files and asserts that the four high-impact
 * components use logical classes instead of physical directional ones where
 * those classes govern layout placement / offset.
 *
 * Runner: Vitest (included via `tests/unit/**\/*.test.tsx` in vitest.config.ts)
 * Command: npm run test:vitest -- --reporter=verbose --testPathPattern=rtl-logical
 */

import "../../_setup/nextIntlDouble";
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const cwd = process.cwd();

function src(rel: string) {
  return readFileSync(resolve(cwd, rel), "utf-8");
}

/**
 * Class tokens of DashboardLayout's mobile-drawer overlay — the element whose
 * class attribute carries `md:hidden` (the overlay is the only `md:hidden`
 * container there). Order-insensitive so re-ordering Tailwind classes does not
 * break the assertions.
 */
function drawerClasses(): string[] {
  const code = src("src/shared/components/layouts/DashboardLayout.tsx");
  const candidates = Array.from(code.matchAll(/className="([^"]*\bfixed\b[^"]*)"/g)).map((m) =>
    m[1].split(/\s+/).filter(Boolean)
  );
  // The drawer overlay: the only `fixed` + `md:hidden` element (a `fixed inset-0`
  // backdrop sibling is not `md:hidden`, so this is unambiguous).
  return candidates.find((tokens) => tokens.includes("md:hidden")) ?? [];
}

// ─── DashboardLayout.tsx ──────────────────────────────────────────────────────

describe("DashboardLayout — mobile sidebar drawer uses logical classes", () => {
  const code = src("src/shared/components/layouts/DashboardLayout.tsx");

  it("anchors the mobile sidebar drawer to a full-viewport overlay (inset-0, direction-agnostic)", () => {
    // The drawer is now a full-viewport overlay (`fixed inset-0 ... md:hidden`) with the
    // Sidebar as a `relative` child — it grows from the inline-start edge implicitly, so no
    // physical `left-0`/`right-0` anchor (or `start-0`, which it replaced) is needed.
    expect(drawerClasses()).toEqual(expect.arrayContaining(["fixed", "inset-0", "md:hidden"]));
  });

  it("does not use bare left-0 for the mobile sidebar drawer", () => {
    // "inset-y-0 left-0" is the old physical class that breaks RTL.
    expect(code).not.toContain("inset-y-0 left-0");
  });

  it("does not slide the drawer with a physical -translate-x-full", () => {
    // The old drawer slid in with `-translate-x-full`, which does not mirror under RTL.
    // The current implementation uses a full-viewport overlay instead of a slide transform.
    expect(code).not.toContain("-translate-x-full");
    expect(drawerClasses()).toEqual(expect.arrayContaining(["fixed", "inset-0", "md:hidden"]));
  });
});

// ─── Sidebar.tsx ─────────────────────────────────────────────────────────────

describe("Sidebar — collapse toggle button aligns without physical margin", () => {
  const code = src("src/shared/components/Sidebar.tsx");

  it("pushes the macOS collapse-toggle to the inline end with a flex spacer", () => {
    // The toggle used `ml-auto` (physical); it is now pushed to the end with a
    // direction-agnostic `flex-1` spacer inside the `flex items-center` header row.
    expect(code).toContain('<div className="flex-1" />');
  });

  it("does not use bare ml-auto in the collapse-toggle className", () => {
    expect(code).not.toContain("ml-auto");
  });
});

// ─── LanguageSelector.tsx ─────────────────────────────────────────────────────

describe("LanguageSelector — dropdown anchors to inline-end", () => {
  const code = src("src/shared/components/LanguageSelector.tsx");

  it("uses end-0 (not right-0) for the dropdown panel", () => {
    expect(code).toContain("end-0");
  });

  it("does not use bare right-0 for the dropdown panel", () => {
    expect(code).not.toContain("right-0");
  });

  it("uses text-start (not text-left) for lang name text alignment", () => {
    expect(code).toContain("text-start");
  });

  it("does not use text-left for lang name text alignment", () => {
    expect(code).not.toContain("text-left");
  });
});

// ─── Select.tsx ───────────────────────────────────────────────────────────────

describe("Select — chevron icon uses logical inset classes", () => {
  const code = src("src/shared/components/Select.tsx");

  it("uses end-0 (not right-0) for the chevron wrapper", () => {
    expect(code).toContain("end-0");
  });

  it("does not use bare right-0 for the chevron wrapper", () => {
    expect(code).not.toContain("right-0");
  });

  it("uses pe-3 (not pr-3) for chevron wrapper padding", () => {
    expect(code).toContain("pe-3");
  });

  it("does not use bare pr-3 for chevron wrapper padding", () => {
    expect(code).not.toContain("pr-3");
  });

  it("uses pe-10 (not pr-10) for the select element right-pad (space for chevron)", () => {
    expect(code).toContain("pe-10");
  });

  it("does not use bare pr-10 for the select element", () => {
    expect(code).not.toContain("pr-10");
  });
});
