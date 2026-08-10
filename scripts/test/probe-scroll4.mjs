// Test: is main scroll preserved across client-side nav (sidebar Home link)?
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

async function state(label) {
  const s = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      url: location.pathname,
      scrollTop: main ? main.scrollTop : -1,
      scrollH: main ? main.scrollHeight : -1,
      clientH: main ? main.clientHeight : -1,
      winY: window.scrollY,
    };
  });
  console.log(`[${label}]`, JSON.stringify(s));
}

// land on providers (long page) via full load
await page.goto(`${BASE}/dashboard/providers`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await state("providers loaded");
await page.evaluate(() => {
  const main = document.querySelector("main");
  if (main && main.scrollHeight > main.clientHeight) main.scrollTop = 800;
});
await page.waitForTimeout(300);
await state("providers scrolled 800");

// client-side nav via sidebar Home link
const homeLink = page.locator("aside a[href='/home']").last();
console.log("home link count:", await homeLink.count());
if (await homeLink.count()) {
  await homeLink.click();
  await page.waitForTimeout(2500);
  await state("after client nav to /home");
}
await browser.close();
