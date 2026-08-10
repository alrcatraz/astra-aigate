// Component QA — verify floating layers (modals, dropdowns) render on top
// and pages have no console errors. Run: node scripts/test/component-qa.mjs
import { chromium } from "playwright";

const BASE = "http://10.0.40.1:20129";
const PASSWORD = "CHANGEME";

const results = [];
let errors = [];

function report(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
});
const page = await context.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console.error] ${msg.text().slice(0, 200)}`);
});
page.on("pageerror", (err) => errors.push(`[pageerror] ${String(err).slice(0, 200)}`));

// ---- Login ----
await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1500);

const pw = page.locator('input[type="password"]').first();
if (await pw.count()) {
  await pw.fill(PASSWORD);
  await page
    .getByRole("button", { name: /sign in|anmelden|einloggen/i })
    .first()
    .click();
  await page.waitForTimeout(2500);
}
report("Login", !/signin|login/.test(new URL(page.url()).pathname), page.url());

// ---- 1. Combos create modal ----
await page.goto(`${BASE}/dashboard/combos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
const createBtn = page.getByRole("button", { name: /create|erstellen|neu|kombination/i }).first();
if (await createBtn.count()) {
  await createBtn.click();
  await page.waitForTimeout(800);
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.count()) {
    const info = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const r = d.getBoundingClientRect();
      const cx = Math.min(r.left + r.width / 2, window.innerWidth - 2);
      const cy = Math.min(r.top + r.height / 2, window.innerHeight - 2);
      const top = document.elementFromPoint(cx, cy);
      const z = getComputedStyle(d.closest(".fixed") || d).zIndex;
      const title = d.querySelector("h2, h3")?.textContent?.trim() || "(no h2/h3)";
      const inputs = [...d.querySelectorAll("input, select, textarea")]
        .map((i) => i.tagName + (i.placeholder ? `[${i.placeholder.slice(0, 20)}]` : ""))
        .slice(0, 8);
      return { z, title, inputs, covered: !(top === d || d.contains(top)) };
    });
    report(
      "Combos: create modal opens on top",
      info.z === "50" && !info.covered,
      `z=${info.z} title="${info.title}" inputs=[${info.inputs.join(", ")}] covered=${info.covered}`
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  } else {
    report("Combos: create modal opens", false, "no [role=dialog] after click");
  }
} else {
  report("Combos: create modal opens", false, "create button not found");
}

// ---- 2. Analytics time-range segmented control (not a dropdown; verify it exists) ----
await page.goto(`${BASE}/dashboard/analytics`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
const segBtns = page.locator("main button", { hasText: /7D|1D|30D/ });
if (await segBtns.count()) {
  report(
    "Analytics: time-range segmented control present",
    true,
    `${await segBtns.count()} buttons (1D/7D/30D/90D/YTD)`
  );
} else {
  const mainText = (
    await page
      .locator("main")
      .innerText()
      .catch(() => "")
  ).slice(0, 100);
  report("Analytics: time-range segmented control", false, `not found. main: ${mainText}`);
}

// ---- 2b. Analytics filter dropdown (unfold_more "All") ----
const unfoldBtn = page.locator("main button").filter({ hasText: "unfold_more" }).first();
if (await unfoldBtn.count()) {
  await unfoldBtn.click();
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("main div.absolute")].filter(
      (d) => d.offsetParent !== null
    );
    if (!panels.length) return { found: false };
    const p = panels[0];
    const r = p.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(r.left + r.width / 2, window.innerWidth - 2),
      Math.min(r.top + r.height / 2, window.innerHeight - 2)
    );
    return {
      found: true,
      covered: !(p.contains(top) || p.parentElement?.contains(top)),
      z: getComputedStyle(p).zIndex,
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
    };
  });
  report(
    "Analytics: filter dropdown on top",
    info.found && !info.covered,
    info.found
      ? `z=${info.z} covered=${info.covered} rect=${JSON.stringify(info.rect)}`
      : "no panel"
  );
  await page.keyboard.press("Escape");
} else {
  report("Analytics: filter dropdown", false, "unfold_more button not found");
}

// ---- 3. Settings appearance: language selector ----
await page.goto(`${BASE}/dashboard/settings/appearance`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const langBtn = page
  .locator("main button")
  .filter({ hasText: /^EN|^DE|^中文|^English|^Deutsch/ })
  .first();
if (await langBtn.count()) {
  await langBtn.click();
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("main div.absolute button")].filter(
      (b) => b.offsetParent !== null
    );
    const el = btns.find((b) => /English|Deutsch|中文/.test(b.textContent));
    if (!el) return { found: false };
    const panel = el.closest("div.absolute");
    const r = panel.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(r.left + r.width / 2, window.innerWidth - 2),
      Math.min(r.top + r.height / 2, window.innerHeight - 2)
    );
    return { found: true, covered: !panel.contains(top), z: getComputedStyle(panel).zIndex };
  });
  report(
    "Appearance: language dropdown on top",
    info.found && !info.covered,
    info.found ? `z=${info.z} covered=${info.covered}` : "panel not found"
  );
  await page.keyboard.press("Escape");
} else {
  report("Appearance: language selector", false, "lang button not found in main");
}

// ---- 4. Logs page export dropdown (id=export-logs-btn) ----
await page.goto(`${BASE}/dashboard/logs`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const expBtn = page.locator("#export-logs-btn");
if (await expBtn.count()) {
  await expBtn.click();
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("main div.absolute")].filter(
      (d) => d.offsetParent !== null
    );
    if (!panels.length) return { found: false };
    const p = panels[0];
    const r = p.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(r.left + r.width / 2, window.innerWidth - 2),
      Math.min(r.top + r.height / 2, window.innerHeight - 2)
    );
    return {
      found: true,
      covered: !(p.contains(top) || p.parentElement?.contains(top)),
      z: getComputedStyle(p).zIndex,
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      items: p.querySelectorAll("button").length,
    };
  });
  report(
    "Logs: export dropdown on top",
    info.found && !info.covered,
    info.found
      ? `z=${info.z} covered=${info.covered} items=${info.items} rect=${JSON.stringify(info.rect)}`
      : "no panel opened"
  );
  await page.keyboard.press("Escape");
} else {
  report("Logs: export dropdown", false, "#export-logs-btn not found");
}

// ---- 5. Page-title header language selector (inside main) ----
const headerLang = page.locator("main header button[title]").first();
if (await headerLang.count()) {
  const title = await headerLang.getAttribute("title");
  await headerLang.click();
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const panel = [...document.querySelectorAll("main header div.absolute")].find(
      (d) => d.offsetParent !== null && /English|Deutsch/.test(d.textContent)
    );
    if (!panel) return { found: false };
    const r = panel.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(r.left + r.width / 2, window.innerWidth - 2),
      Math.min(r.top + r.height / 2, window.innerHeight - 2)
    );
    return {
      found: true,
      covered: !panel.contains(top),
      z: getComputedStyle(panel).zIndex,
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
    };
  });
  report(
    "Header: language selector on top",
    info.found && !info.covered,
    info.found
      ? `z=${info.z} covered=${info.covered} rect=${JSON.stringify(info.rect)}`
      : "panel not found"
  );
  await page.keyboard.press("Escape");
} else {
  report("Header: language selector", false, "no main header button[title]");
}

// ---- 6. Command palette (Ctrl+K) ----
await page.keyboard.press("Control+k");
await page.waitForTimeout(600);
const palette = await page.evaluate(() => {
  const el = [...document.querySelectorAll("div")].find(
    (d) => String(d.className).includes("z-[6") && getComputedStyle(d).position === "fixed"
  );
  return el ? { z: getComputedStyle(el).zIndex, cls: String(el.className).slice(0, 50) } : null;
});
report(
  "Command palette opens (Ctrl+K)",
  palette !== null,
  palette ? `z=${palette.z} cls=${palette.cls}` : "z-[60] fixed element not found"
);
await page.keyboard.press("Escape");

// ---- Console errors ----
const realErrors = errors.filter(
  (e) => !e.includes("favicon") && !e.includes("Failed to load resource") && !e.includes("404")
);
report(
  "No console/page errors",
  realErrors.length === 0,
  realErrors.length ? realErrors.slice(0, 4).join(" | ") : "clean"
);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
process.exit(failed.length ? 1 : 0);
