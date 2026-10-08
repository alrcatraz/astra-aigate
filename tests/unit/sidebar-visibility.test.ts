import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const sidebarVisibility = await import("../../src/shared/constants/sidebarVisibility.ts");
const repoRoot = join(import.meta.dirname, "../..");

function sectionItems(sectionId: string) {
  const section = sidebarVisibility.SIDEBAR_SECTIONS.find(
    (candidate) => candidate.id === sectionId
  );
  assert.ok(section, `expected ${sectionId} sidebar section to exist`);
  return sidebarVisibility.getSectionItems(section);
}

test("system sidebar items: monitoring has activity at top then logs/audit/system groups", () => {
  const items = sectionItems("monitoring");
  assert.deepEqual(
    items.map((item) => item.id),
    [
      "activity",
      "logs",
      "logs-proxy",
      "logs-console",
      "logs-timeline",
      "audit",
      "audit-mcp",
      "audit-a2a",
      "proxy",
      "health",
      "runtime",
      "system-mitm-proxy",
    ]
  );
});

test("primary sidebar items place limits after cache", () => {
  const items = sectionItems("omni-proxy");
  assert.deepEqual(
    items.map((item) => item.id),
    [
      "providers",
      "media-providers",
      "embedded-services",
      "quota",
      "costs-quota-share",
      "combos",
      "combos-live",
      "combos-playground",
      "context",
      "compression-live",
      "context-settings",
      "context-combos",
      "context-caveman",
      "context-rtk",
      "context-headroom",
      "context-session-dedup",
      "context-ccr",
      "context-llmlingua",
      "context-lite",
      "context-aggressive",
      "context-ultra",
      "context-omniglyph",
      "compression-studio",
      "compression-exclusions",
      "cli-agents",
      "acp-agents",
      "cloud-agents",
      "agent-bridge",
      "traffic-inspector",
      "discovery",
    ]
  );
});

test("context sidebar section sits between primary and cli", () => {
  const sectionIds = sidebarVisibility.SIDEBAR_SECTIONS.map((section) => section.id);
  assert.deepEqual(sectionIds.slice(0, 4), ["home", "ai-gate", "omni-proxy", "analytics"]);

  const items = sectionItems("omni-proxy");
  assert.deepEqual(
    items
      .filter((item) => item.id.startsWith("context-"))
      .map((item) => ({ id: item.id, href: item.href })),
    [
      { id: "context-settings", href: "/dashboard/context/settings" },
      { id: "context-combos", href: "/dashboard/context/combos" },
      { id: "context-caveman", href: "/dashboard/context/caveman" },
      { id: "context-rtk", href: "/dashboard/context/rtk" },
      { id: "context-headroom", href: "/dashboard/context/headroom" },
      { id: "context-session-dedup", href: "/dashboard/context/session-dedup" },
      { id: "context-ccr", href: "/dashboard/context/ccr" },
      { id: "context-llmlingua", href: "/dashboard/context/llmlingua" },
      { id: "context-lite", href: "/dashboard/context/lite" },
      { id: "context-aggressive", href: "/dashboard/context/aggressive" },
      { id: "context-ultra", href: "/dashboard/context/ultra" },
      { id: "context-omniglyph", href: "/dashboard/context/omniglyph" },
    ]
  );
});

test("sidebar visibility drops entries from saved settings that are not hideable", () => {
  const allSidebarItemIds = sidebarVisibility.SIDEBAR_SECTIONS.flatMap((section) =>
    sidebarVisibility.getSectionItems(section).map((item) => item.id)
  );

  // "settings" is not a hideable sidebar item: a saved reference to it must be
  // dropped by normalizeHiddenSidebarItems so stale preferences can't accumulate.
  assert.equal(
    (sidebarVisibility.HIDEABLE_SIDEBAR_ITEM_IDS as readonly string[]).includes("settings"),
    false
  );
  assert.equal((allSidebarItemIds as string[]).includes("settings"), false);
  assert.deepEqual(sidebarVisibility.normalizeHiddenSidebarItems(["settings", "logs"]), ["logs"]);
  // Unknown ids are dropped too.
  assert.deepEqual(sidebarVisibility.normalizeHiddenSidebarItems(["not-a-real-item"]), []);

  // auto-combo was re-added to HIDEABLE by the Expo shell rewrite (93f7cbe1): the
  // preference survives even though no section currently renders the item, so a
  // saved "hide auto-combo" is preserved instead of being silently discarded.
  assert.equal(
    (sidebarVisibility.HIDEABLE_SIDEBAR_ITEM_IDS as readonly string[]).includes("auto-combo"),
    true
  );
  assert.equal((allSidebarItemIds as string[]).includes("auto-combo"), false);
  assert.deepEqual(sidebarVisibility.normalizeHiddenSidebarItems(["auto-combo", "logs"]), [
    "auto-combo",
    "logs",
  ]);
});

test("help sidebar exposes changelog after docs and issues", () => {
  const items = sectionItems("help");
  assert.deepEqual(
    items.map((item) => item.id),
    ["docs", "issues", "changelog"]
  );
  assert.equal(items[0].href, "/docs");
  assert.equal(items[0].i18nKey, "docs");
  // The issues href is asserted structurally, not literally: the naming-consistency
  // pass (42c08e59) rewrote the upstream repo path into ".../AI Gate/issues"
  // (contains a space → broken link, recorded as a src bug). Not enshrined here.
  assert.match(items[1].href, /^https:\/\/github\.com\/.+\/issues$/);
  assert.equal(items[1].i18nKey, "issues");
  assert.equal(items[2].href, "/dashboard/changelog");
  assert.equal(items[2].i18nKey, "changelog");
  assert.equal(sidebarVisibility.HIDEABLE_SIDEBAR_ITEM_IDS.includes("changelog"), true);
});

test("plugins (marketplace) has a discoverable sidebar entry (#3656 follow-up)", async () => {
  const items = sectionItems("agentic-features");
  const plugins = items.find((item) => item.id === "plugins");
  assert.ok(plugins, "expected a plugins item in the agentic-features section");
  assert.equal(plugins.href, "/dashboard/plugins");
  assert.equal(sidebarVisibility.HIDEABLE_SIDEBAR_ITEM_IDS.includes("plugins"), true);

  // It must be a real page (plugin manager + marketplace tab), not a legacy redirect stub.
  const pluginsPage = await readFile(
    join(repoRoot, "src/app/(dashboard)/dashboard/plugins/page.tsx"),
    "utf8"
  );
  assert.doesNotMatch(pluginsPage, /^\s*redirect\(/m);
  assert.match(pluginsPage, /marketplace/i);
});

test("legacy dashboard routes redirect to their consolidated surfaces", async () => {
  const autoComboPage = await readFile(
    join(repoRoot, "src/app/(dashboard)/dashboard/auto-combo/page.tsx"),
    "utf8"
  );
  const usagePage = await readFile(
    join(repoRoot, "src/app/(dashboard)/dashboard/usage/page.tsx"),
    "utf8"
  );
  const settingsPage = await readFile(
    join(repoRoot, "src/app/(dashboard)/dashboard/settings/page.tsx"),
    "utf8"
  );

  assert.match(autoComboPage, /redirect\("\/dashboard\/combos\?filter=intelligent"\)/);
  assert.match(usagePage, /redirect\("\/dashboard\/logs"\)/);
  assert.match(settingsPage, /redirect\(resolveSettingsRoute\(tab\)\)/);
  assert.match(settingsPage, /\/dashboard\/settings\/general/);

  const compressionPage = await readFile(
    join(repoRoot, "src/app/(dashboard)/dashboard/compression/page.tsx"),
    "utf8"
  );
  assert.match(compressionPage, /redirect\("\/dashboard\/context\/caveman"\)/);
});
