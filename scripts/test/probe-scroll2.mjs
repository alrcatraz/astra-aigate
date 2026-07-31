// Probe sidebar links + test scroll persistence with English UI
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

// print all sidebar links
const links = await page.locator("aside a").allInnerTexts();
console.log(
  "sidebar links:",
  JSON.stringify(links.map((t) => t.trim().replace(/\s+/g, " ").slice(0, 40)))
);

async function scrollState(label) {
  const s = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      mainScrollTop: main ? main.scrollTop : -1,
      mainScrollHeight: main ? main.scrollHeight : -1,
      mainClientHeight: main ? main.clientHeight : -1,
      windowScrollY: window.scrollY,
    };
  });
  console.log(`[${label}]`, JSON.stringify(s));
}

// find a long page — try providers list
const prov = page
  .locator("aside a")
  .filter({ hasText: /Providers/ })
  .first();
console.log("providers link count:", await prov.count());
if (await prov.count()) {
  await prov.click();
  await page.waitForTimeout(2500);
  await scrollState("providers loaded");
  // scroll main down if possible
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 500;
  });
  await page.waitForTimeout(300);
  await scrollState("providers scrolled 500");
  // now navigate to another page via sidebar
  const combos = page
    .locator("aside a")
    .filter({ hasText: /Combos/ })
    .first();
  console.log("combos link count:", await combos.count());
  if (await combos.count()) {
    await combos.click();
    await page.waitForTimeout(2500);
    await scrollState("after nav to combos");
  }
}
await browser.close();
