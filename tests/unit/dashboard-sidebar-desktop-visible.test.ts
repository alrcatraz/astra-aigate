import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readSrc(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

// Regression guard: the desktop dashboard sidebar must stay visible on desktop.
// This originally pinned an explicit `.dashboard-sidebar-desktop` class backed by
// a 1024px media query in globals.css; the Expo shell rewrite (93f7cbe1) replaced
// that mechanism coherently in both the TSX and the CSS with the mobile-first
// `hidden md:flex` Tailwind cascade. The guard now pins that contract: the
// desktop wrapper shows at >=768px, the mobile overlay hides at the same
// breakpoint, and neither the old `hidden/lg:flex` cascade nor the orphaned CSS
// class may come back.

test("DashboardLayout desktop sidebar uses the hidden/md:flex responsive cascade", () => {
  const source = readSrc("src/shared/components/layouts/DashboardLayout.tsx");

  // The desktop sidebar wrapper must use the exact mobile-first cascade:
  // hidden below md, flex at >=768px. (The header's collapse button also starts
  // with "hidden md:flex" but carries extra utilities, so the exact-string match
  // pins the sidebar wrapper specifically.)
  assert.match(
    source,
    /className="hidden md:flex"/,
    "Desktop sidebar wrapper must use the hidden md:flex cascade"
  );

  // The fragile lg variant must never come back.
  assert.doesNotMatch(
    source,
    /className="hidden[^"]*lg:flex"/,
    "Desktop sidebar wrapper must not rely on a hidden/lg:flex Tailwind cascade"
  );

  // The mobile overlay must flip at the same breakpoint the desktop wrapper
  // appears, so exactly one sidebar is visible at any viewport width.
  assert.match(
    source,
    /className="fixed inset-0 z-50 flex md:hidden"/,
    "Mobile sidebar overlay must use md:hidden to pair with the desktop hidden/md:flex wrapper"
  );
});

test("globals.css does not define the removed .dashboard-sidebar-desktop class", () => {
  const css = readSrc("src/app/globals.css");

  // Desktop visibility now lives entirely in DashboardLayout's hidden/md:flex
  // cascade; a CSS rule here would be an orphaned second source of truth (and
  // the pre-rewrite display:none rule is exactly what once left the sidebar
  // permanently hidden).
  assert.doesNotMatch(
    css,
    /\.dashboard-sidebar-desktop\s*\{/,
    "globals.css must not define .dashboard-sidebar-desktop — visibility belongs to the hidden/md:flex cascade in DashboardLayout"
  );
});
