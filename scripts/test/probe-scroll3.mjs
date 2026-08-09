// Correct client-side nav scroll test: expand group, click sub-link
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

async function scrollState(label) {
  const s = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      url: location.pathname,
      mainScrollTop: main ? main.scrollTop : -1,
      mainScrollHeight: main ? main.scrollHeight : -1,
      mainClientHeight: main ? main.clientHeight : -1,
      windowScrollY: window.scrollY,
    };
  });
  console.log(`[${label}]`, JSON.stringify(s));
}

// 1. expand OmniProxy group, click Endpoints sub-link (client nav)
await page
  .locator("aside button")
  .filter({ hasText: /OmniProxy/ })
  .first()
  .click();
await page.waitForTimeout(500);
const endpoints = page
  .locator("aside a")
  .filter({ hasText: /Endpoints/ })
  .first();
console.log("endpoints link count:", await endpoints.count());
if (await endpoints.count()) {
  await endpoints.click();
  await page.waitForTimeout(2500);
  await scrollState("endpoints loaded");
  // scroll main down
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = Math.min(600, main.scrollHeight);
  });
  await page.waitForTimeout(300);
  await scrollState("endpoints scrolled");
  // 2. expand Analytics group, click Usage sub-link (client nav)
  await page
    .locator("aside button")
    .filter({ hasText: /Analytics/ })
    .first()
    .click();
  await page.waitForTimeout(500);
  const usage = page.locator("aside a").filter({ hasText: /Usage/ }).first();
  if (await usage.count()) {
    await usage.click();
    await page.waitForTimeout(2500);
    await scrollState("after nav to analytics/usage");
  } else {
    console.log("usage link not found");
  }
}
await browser.close();
