// Post-fix regression: nav overhaul, subgroup collapse, independent scroll, i18n.
// Usage: BASE=http://host:port PASSWORD=xxx node scripts/test/regression-final.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const PASSWORD = process.env.PASSWORD || "CHANGEME";
const results = [];
const ok = (name, cond, extra = "") =>
  results.push({ name, pass: !!cond, extra: String(extra).slice(0, 120) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("live-ws") && !m.text().includes("WebSocket"))
    results.push({ name: "console.error", pass: false, extra: m.text().slice(0, 120) });
});

// ── 1. Login page: auth keys must render, not raw key names ──
await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const bodyText1 = await page.evaluate(() => document.body.innerText);
ok("login: no raw auth.signInDescription key", !bodyText1.includes("auth.signInDescription"));
ok("login: no raw auth.passwordPlaceholder key", !bodyText1.includes("auth.passwordPlaceholder"));
ok("login: has password input", (await page.locator('input[type="password"]').count()) > 0);

const pw = page.locator('input[type="password"]').first();
if (await pw.count()) {
  await pw.fill(PASSWORD);
  await page
    .getByRole("button", { name: /sign in|anmelden|einloggen/i })
    .first()
    .click();
  await page.waitForTimeout(2500);
}

// Expand the OmniRoute section so group titles and items are visible
// Section headers are div[role=button][aria-expanded] (not <button>)
const omniBtn = page.locator('[role="button"][aria-expanded]', { hasText: "OmniRoute" }).first();
if ((await omniBtn.count()) && (await omniBtn.getAttribute("aria-expanded")) === "false") {
  await omniBtn.click();
  await page.waitForTimeout(500);
}

// ── 2. Sidebar structure ──
const sb = await page.evaluate(() => {
  const el = document.querySelector("[class*='custom-scrollbar']");
  if (!el) return null;
  return {
    text: el.innerText.replace(/\s+/g, " "),
    links: [...el.querySelectorAll("a")]
      .map((a) => a.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean),
    scroll: { ch: el.clientHeight, sh: el.scrollHeight, overflowY: getComputedStyle(el).overflowY },
  };
});
ok("sidebar found", !!sb);
if (sb) {
  ok(
    "section renamed OmniRoute (no OmniProxy)",
    sb.text.includes("OmniRoute") && !sb.text.includes("OmniProxy")
  );
  ok("Routing & Access group", sb.text.toLowerCase().includes("routing & access"));
  ok("Combos group", sb.text.toLowerCase().includes("combos"));
  ok("redundant items gone: Auto Combo", !sb.text.includes("Auto Combo"));
  ok("redundant items gone: 1Proxy", !sb.text.includes("1Proxy"));
  ok("redundant items gone: MITM", !sb.text.includes("MITM"));
  ok("redundant items gone: Pricing", !sb.text.includes("Pricing"));
  ok("redundant items gone: Limits", !sb.text.includes("Limits"));
  const scrollable = sb.scroll.sh > sb.scroll.ch;
  ok(
    "sidebar internally scrollable",
    scrollable,
    `ch=${sb.scroll.ch} sh=${sb.scroll.sh} oy=${sb.scroll.overflowY}`
  );
}

// ── 3. Sub-group collapse ──
const combosBtn = page.locator("button", { hasText: "Combos" }).first();
if (await combosBtn.count()) {
  const linkCountBefore = await page.locator('a[href*="/dashboard/combos"]').count();
  await combosBtn.click();
  await page.waitForTimeout(400);
  const linkCountAfter = await page.locator('a[href*="/dashboard/combos"]').count();
  ok(
    "combos collapse hides links",
    linkCountAfter < linkCountBefore,
    `${linkCountBefore}->${linkCountAfter}`
  );
  await combosBtn.click();
  await page.waitForTimeout(400);
  const linkCountRestored = await page.locator('a[href*="/dashboard/combos"]').count();
  ok(
    "combos expand restores links",
    linkCountRestored === linkCountBefore,
    `${linkCountRestored}/${linkCountBefore}`
  );
}

// ── 4. Independent scroll + route-change reset (long page) ──
await page.goto(`${BASE}/dashboard/logs`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const scrollProbe = await page.evaluate(() => {
  const main = document.querySelector("#main-content");
  const sidebar = document.querySelector("[class*='custom-scrollbar']");
  if (!main || !sidebar) return null;
  const mainScrollable = main.scrollHeight > main.clientHeight;
  return { mainScrollable, sbSh: sidebar.scrollHeight, sbCh: sidebar.clientHeight };
});
ok(
  "main independently scrollable",
  !!scrollProbe && scrollProbe.mainScrollable,
  JSON.stringify(scrollProbe)
);
if (scrollProbe?.mainScrollable) {
  await page.evaluate(() => {
    document.querySelector("#main-content").scrollTop = 300;
  });
  await page.waitForTimeout(300);
  const target = page.locator("[class*='custom-scrollbar'] a[href*='/dashboard/activity']").first();
  await target.click();
  await page.waitForTimeout(1500);
  const reset = await page.evaluate(() => document.querySelector("#main-content")?.scrollTop);
  ok("main scroll reset on route change", reset === 0, `scrollTop=${reset}`);
}

// ── 5. zh-CN locale ──
const langSel = page.locator("select, [role='combobox']").first();
if (await langSel.count()) {
  const before = await page.evaluate(() => document.body.innerText);
  try {
    await langSel.selectOption({ label: /中文|简体/ });
  } catch {
    await langSel.click().catch(() => {});
  }
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => document.body.innerText);
  ok("zh-CN switch changes language", before !== after);
}

// ── summary ──
const failed = results.filter((r) => !r.pass);
console.log("\n=== REGRESSION RESULTS ===");
for (const r of results)
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.extra ? ` — ${r.extra}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
