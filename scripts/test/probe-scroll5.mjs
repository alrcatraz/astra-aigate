// Confirm: window scroll preserved across client-side nav?
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

async function state(label) {
  const s = await page.evaluate(() => ({
    url: location.pathname,
    winY: window.scrollY,
    docH: document.documentElement.scrollHeight,
    winH: window.innerHeight,
  }));
  console.log(`[${label}]`, JSON.stringify(s));
}

await page.goto(`${BASE}/dashboard/providers`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 4000));
await page.waitForTimeout(400);
await state("providers scrolled winY=4000");

const homeLink = page.locator("aside a[href='/home']").last();
await homeLink.click();
await page.waitForTimeout(2500);
await state("after client nav to /home");

// also test back to a long page
await page.goto(`${BASE}/dashboard/providers`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await page.evaluate(() => window.scrollTo(0, 6000));
await page.waitForTimeout(300);
await state("providers scrolled winY=6000");
// navigate to logs via sidebar? logs link is in a group; expand Monitoring or use URL. Use Home link again then check
await page.locator("aside a[href='/home']").last().click();
await page.waitForTimeout(2200);
await state("after 2nd client nav to /home");

await browser.close();
