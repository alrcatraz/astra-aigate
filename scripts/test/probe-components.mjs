// Probe pages to find correct selectors for dropdown components
import { chromium } from "playwright";

const BASE = "http://10.0.40.1:20129";
const PASSWORD = "CHANGEME";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });

await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
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

// Probe analytics
await page.goto(`${BASE}/dashboard/analytics`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
console.log("=== ANALYTICS main buttons ===");
const btns = await page.locator("main button").allInnerTexts();
console.log(
  btns
    .slice(0, 12)
    .map((t) => JSON.stringify(t.trim().slice(0, 40)))
    .join("\n")
);

// Probe logs
await page.goto(`${BASE}/dashboard/logs`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
console.log("\n=== LOGS main buttons ===");
const lbtns = await page.locator("main button").allInnerTexts();
console.log(
  lbtns
    .slice(0, 12)
    .map((t) => JSON.stringify(t.trim().slice(0, 40)))
    .join("\n")
);

// Probe header language selector
console.log("\n=== HEADER buttons ===");
const hbtns = await page.locator("header button").allInnerTexts();
console.log(
  hbtns
    .slice(0, 10)
    .map((t) => JSON.stringify(t.trim().slice(0, 40)))
    .join("\n")
);

// Probe command palette classes
const paletteClasses = await page.evaluate(() => {
  const fixed = [...document.querySelectorAll("div")].filter(
    (d) => getComputedStyle(d).position === "fixed" && d.offsetParent !== null
  );
  return fixed
    .slice(0, 8)
    .map((d) => ({ cls: d.className?.toString().slice(0, 80), z: getComputedStyle(d).zIndex }));
});
console.log("\n=== FIXED elements on logs page ===");
console.log(JSON.stringify(paletteClasses, null, 1));

// Probe appearance language dropdown coverage in detail
await page.goto(`${BASE}/dashboard/settings/appearance`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
const langBtn = page
  .locator("main button")
  .filter({ hasText: /^EN|^DE/ })
  .first();
if (await langBtn.count()) {
  await langBtn.click();
  await page.waitForTimeout(600);
  const detail = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("main div.absolute")].filter(
      (d) => d.offsetParent !== null
    );
    return panels.map((p) => {
      const r = p.getBoundingClientRect();
      const cx = Math.min(r.left + r.width / 2, window.innerWidth - 2);
      const cy = Math.min(r.top + r.height / 2, window.innerHeight - 2);
      const top = document.elementFromPoint(cx, cy);
      return {
        cls: p.className?.toString().slice(0, 60),
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        text: p.textContent?.trim().slice(0, 50),
        z: getComputedStyle(p).zIndex,
        coveredBy:
          top === p || p.contains(top)
            ? "none"
            : `${top?.tagName}.${String(top?.className).slice(0, 30)} "${top?.textContent?.trim().slice(0, 25)}"`,
      };
    });
  });
  console.log("\n=== APPEARANCE language panels ===");
  console.log(JSON.stringify(detail, null, 1));
  // also check what's at the panel center vs the trigger button
  const trig = await page.evaluate(() => {
    const b = [...document.querySelectorAll("main button")].find((x) =>
      /^EN|^DE/.test(x.textContent.trim())
    );
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(r.left + r.width / 2, window.innerWidth - 2),
      Math.min(r.top + r.height / 2, window.innerHeight - 2)
    );
    return {
      trigRect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      topAtTrigger: top?.textContent?.trim().slice(0, 30),
    };
  });
  console.log("trigger:", JSON.stringify(trig));
}

await browser.close();
