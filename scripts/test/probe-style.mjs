// Check computed styles of the appearance language dropdown panel
import { chromium } from "playwright";

const BASE = "http://10.30.40.1:20129";
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

await page.goto(`${BASE}/dashboard/settings/appearance`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
const langBtn = page
  .locator("main button")
  .filter({ hasText: /^EN|^DE/ })
  .first();
await langBtn.click();
await page.waitForTimeout(700);

const style = await page.evaluate(() => {
  const panel = [...document.querySelectorAll("main div.absolute")].find(
    (d) =>
      d.offsetParent !== null && d.querySelector("button") && /English|Deutsch/.test(d.textContent)
  );
  if (!panel) return { found: false };
  const cs = getComputedStyle(panel);
  const r = panel.getBoundingClientRect();
  // check every ancestor for transform/filter/opacity/overflow that could hide or stack the panel
  const ancestors = [];
  let el = panel.parentElement;
  while (el && el !== document.body) {
    const a = getComputedStyle(el);
    if (
      a.transform !== "none" ||
      a.opacity !== "1" ||
      a.filter !== "none" ||
      a.overflow !== "visible" ||
      a.position !== "static" ||
      a.zIndex !== "auto"
    ) {
      ancestors.push({
        tag: el.tagName,
        cls: String(el.className).slice(0, 60),
        transform: a.transform.slice(0, 40),
        opacity: a.opacity,
        overflow: a.overflow,
        position: a.position,
        z: a.zIndex,
      });
    }
    el = el.parentElement;
  }
  return {
    found: true,
    opacity: cs.opacity,
    visibility: cs.visibility,
    display: cs.display,
    transform: cs.transform.slice(0, 50),
    zIndex: cs.zIndex,
    animation: cs.animationName,
    animationFill: cs.animationFillMode,
    rect: {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    },
    nonDefaultAncestors: ancestors,
  };
});
console.log(JSON.stringify(style, null, 1));
await browser.close();
