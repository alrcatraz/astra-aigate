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
await page.goto(`${BASE}/dashboard/logs`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const header = document.querySelector("header");
  if (!header) return { headerFound: false };
  const btns = [...header.querySelectorAll("button")];
  return {
    headerFound: true,
    count: btns.length,
    btns: btns.map((b) => ({
      title: b.getAttribute("title"),
      aria: b.getAttribute("aria-label"),
      text: b.textContent.trim().slice(0, 20),
    })),
  };
});
console.log(JSON.stringify(info, null, 1));
const exp = page.locator("#export-logs-btn");
console.log("export-logs-btn count:", await exp.count());
if (await exp.count()) {
  await exp.click();
  await page.waitForTimeout(600);
  const pan = await page.evaluate(() => {
    const el = document.querySelector('[id^="export-"][class*="absolute"]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(r.left + r.width / 2, window.innerWidth - 2),
      Math.min(r.top + r.height / 2, window.innerHeight - 2)
    );
    return {
      found: true,
      covered: !(el.contains(top) || el.parentElement?.contains(top)),
      z: getComputedStyle(el).zIndex,
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      items: el.querySelectorAll("button").length,
    };
  });
  console.log("export panel:", JSON.stringify(pan));
}
await browser.close();
