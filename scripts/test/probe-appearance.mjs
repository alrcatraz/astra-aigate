// Visual check: appearance language dropdown coverage
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

// click the language selector in main
const langBtn = page
  .locator("main button")
  .filter({ hasText: /^EN|^DE/ })
  .first();
await langBtn.click();
await page.waitForTimeout(700);

// screenshot the dropdown area
const info = await page.evaluate(() => {
  const panel = [...document.querySelectorAll("main div.absolute")].find(
    (d) => d.offsetParent !== null && d.querySelector("button")
  );
  if (!panel) return null;
  const r = panel.getBoundingClientRect();
  // sample multiple points in the panel
  const pts = [];
  for (const [fx, fy] of [
    [0.25, 0.25],
    [0.5, 0.3],
    [0.5, 0.6],
    [0.5, 0.9],
    [0.75, 0.5],
  ]) {
    const x = Math.min(r.left + r.width * fx, window.innerWidth - 2);
    const y = Math.min(r.top + r.height * fy, window.innerHeight - 2);
    const t = document.elementFromPoint(x, y);
    pts.push({
      x: Math.round(x),
      y: Math.round(y),
      el: `${t?.tagName}.${String(t?.className).slice(0, 40)}`,
      txt: t?.textContent?.trim().slice(0, 20),
    });
  }
  // what element has the highest z-index in the panel's rect region?
  return {
    panelRect: {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    },
    points: pts,
  };
});
console.log(JSON.stringify(info, null, 1));

await page.screenshot({ path: "/tmp/appearance-lang-dropdown.png" });
console.log("screenshot saved: /tmp/appearance-lang-dropdown.png");
await browser.close();
