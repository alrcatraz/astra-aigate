// Reproduce: does scroll position persist across sidebar navigation?
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
    const scrollers = [...document.querySelectorAll("main *")].filter(
      (el) => el.scrollHeight > el.clientHeight + 50
    );
    return {
      mainScrollTop: main ? main.scrollTop : -1,
      mainScrollHeight: main ? main.scrollHeight : -1,
      mainClientHeight: main ? main.clientHeight : -1,
      windowScrollY: window.scrollY,
      innerScrollers: scrollers.slice(0, 5).map((el) => ({
        cls: String(el.className).slice(0, 50),
        scrollTop: el.scrollTop,
        sh: el.scrollHeight,
        ch: el.clientHeight,
      })),
    };
  });
  console.log(`[${label}]`, JSON.stringify(s));
}

// 1. Go to a long page (logs), scroll main to bottom
await page.goto(`${BASE}/dashboard/logs`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const main = document.querySelector("main");
  if (main) main.scrollTop = main.scrollHeight;
});
await page.waitForTimeout(500);
await scrollState("logs scrolled to bottom");

// 2. Navigate via sidebar link to a different page (combos)
await page
  .locator("aside a", { hasText: "Kombinationen" })
  .first()
  .click()
  .catch(() =>
    page
      .locator("aside a")
      .filter({ hasText: /combos|kombination/i })
      .first()
      .click()
  );
await page.waitForTimeout(2500);
await scrollState("after nav to combos (no reset?)");

// 3. Also test: analytics -> providers (long pages)
await page.evaluate(() => {
  const main = document.querySelector("main");
  if (main) main.scrollTop = 400;
});
await scrollState("analytics-ish scrolled 400");
await page
  .locator("aside a")
  .filter({ hasText: /providers|anbieter/i })
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(2500);
await scrollState("after nav to providers");

await browser.close();
