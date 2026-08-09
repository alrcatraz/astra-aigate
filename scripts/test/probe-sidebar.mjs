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
const info = await page.evaluate(() => {
  const sidebar = document.querySelector("aside, nav, [class*='sidebar' i]");
  if (!sidebar) return { found: false, bodyStart: document.body.innerHTML.slice(0, 300) };
  return {
    found: true,
    tag: sidebar.tagName,
    cls: String(sidebar.className).slice(0, 80),
    btns: [...sidebar.querySelectorAll("button")]
      .map((b) => b.textContent.replace(/\s+/g, " ").trim().slice(0, 40))
      .slice(0, 12),
    links: [...sidebar.querySelectorAll("a")]
      .map((a) => ({
        text: a.textContent.replace(/\s+/g, " ").trim().slice(0, 30),
        href: a.getAttribute("href"),
      }))
      .slice(0, 8),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
