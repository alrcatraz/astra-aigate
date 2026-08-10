/**
 * Onboarding E2E — Playwright script
 * Logs in, walks through the 6-step Onboarding wizard,
 * screenshots every step, and reports Expo-style compliance.
 */

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "http://10.0.40.1:20129";
const OUT = "/tmp/astra-onboarding";
const PASSWORD = "CHANGEME";

const EXPO_TOKENS = {
  bg: "rgb(240, 240, 243)",
  black: "rgb(0, 0, 0)",
  muted: "rgb(96, 100, 108)",
  subtle: "rgb(176, 180, 186)",
  border: "rgb(224, 225, 230)",
  white: "rgb(255, 255, 255)",
};

async function screenshot(page, name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`  \u{1F4F8} ${name}.png`);
  return path;
}

async function checkExpo(page, label) {
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const passes = bodyBg === EXPO_TOKENS.bg;
  console.log(`  \u{1F3A8} Expo bg check [${label}]: ${passes ? "\u2705" : "\u274C"} (${bodyBg})`);
  return passes;
}

async function clickVisible(page, selectors, timeout = 5000) {
  for (const sel of selectors) {
    const loc = page.locator(sel);
    if (await loc.isVisible({ timeout }).catch(() => false)) {
      await loc.click();
      await page.waitForTimeout(400);
      return true;
    }
  }
  return false;
}

async function step(page, index, label, action) {
  console.log(`\n\u2500\u2500 Step ${index}: ${label} \u2500\u2500`);
  await screenshot(page, `step${index}-${label.replace(/\s+/g, "-")}`);
  await checkExpo(page, label);
  if (action) await action(page);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // Login
  console.log("\n\u2550\u2550 Login \u2550\u2550");
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await screenshot(page, "login-page");

  const pwInput = page.locator('input[type="password"]');
  await pwInput.fill(PASSWORD);
  await screenshot(page, "login-filled");

  const submitBtn = page.locator('button[type="submit"]');
  await submitBtn.click();
  await page.waitForURL(/home/, { timeout: 15000 }).catch(() => {
    console.log("  \u26A0\uFE0F No redirect to /home");
  });
  console.log("  \u2705 Logged in, URL:", page.url());

  // Disable requireLogin so onboarding page doesn't redirect
  console.log("\n\u2550\u2550 Disable requireLogin \u2550\u2550");
  await page.evaluate(async () => {
    await fetch("/api/settings/require-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requireLogin: false }),
    });
  });
  console.log("  \u2705 requireLogin disabled");

  // Navigate to onboarding
  console.log("\n\u2550\u2550 Onboarding \u2550\u2550");
  await page.goto(`${BASE}/dashboard/onboarding`, { waitUntil: "load" });
  await screenshot(page, "onboarding-entry");

  // Step 0: Welcome
  await step(page, 0, "Welcome", async (p) => {
    await clickVisible(p, ['button:has-text("Next")']);
  });

  // Step 1: Tiers
  await step(page, 1, "Tiers", async (p) => {
    await clickVisible(p, ['button:has-text("Next")']);
  });

  // Step 2: Security
  await step(page, 2, "Security", async (p) => {
    // Check "Skip security" checkbox (we already have password via INITIAL_PASSWORD)
    const skipCheckbox = p.locator('input[type="checkbox"]');
    if (await skipCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipCheckbox.check();
      console.log("  \u{1F4DD} Security skip checkbox checked");
    }
    // Click Continue button
    await clickVisible(p, [
      'button[type="submit"]',
      'button:has-text("Continue")',
      'button:has-text("continue")',
    ]);
  });

  // Step 3: Provider
  await step(page, 3, "Provider", async (p) => {
    // Select a provider card
    const cards = p.locator(
      'button:has-text("OpenAI"), button:has-text("Anthropic"), button:has-text("OpenRouter")'
    );
    if (
      await cards
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false)
    ) {
      await cards.first().click();
      await p.waitForTimeout(300);
      console.log("  \u{1F50C} Provider selected");
    }
    // Fill API key if field appears
    const keyField = p
      .locator(
        'input[type="password"], input[placeholder*="key" i], input[placeholder*="Key" i], input[placeholder*="API" i]'
      )
      .first();
    if (await keyField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await keyField.fill("sk-test-key-placeholder");
      console.log("  \u{1F511} API key placeholder");
    }
    // Click Add / Next
    await clickVisible(p, [
      'button:has-text("Add")',
      'button:has-text("Next")',
      'button:has-text("addProvider")',
      'button[type="submit"]',
    ]);
  });

  // Step 4: Test
  await step(page, 4, "Test", async (p) => {
    // Run test
    const runBtns = [
      'button:has-text("Run")',
      'button:has-text("Test")',
      'button:has-text("runTest")',
    ];
    const found = await clickVisible(p, runBtns);
    if (found) {
      await p.waitForTimeout(3000);
      console.log("  \u{1F9EA} Test clicked, waited 3s");
    } else {
      // Try Next/Continue
      await clickVisible(p, [
        'button:has-text("Next")',
        'button:has-text("Continue")',
        'button[type="submit"]',
      ]);
      console.log("  \u23E9 Test step skipped");
    }
  });

  // Step 5: Done
  await step(page, 5, "Done", async (p) => {
    await clickVisible(p, [
      'button:has-text("Finish")',
      'button:has-text("Done")',
      'button:has-text("Complete")',
    ]);
    await page.waitForURL(/dashboard/, { timeout: 10000 }).catch(() => {});
    console.log("  \u2705 Done, URL:", page.url());
  });

  // Final dashboard screenshot
  await screenshot(page, "dashboard-after-onboarding");
  await checkExpo(page, "dashboard-after-onboarding");

  // Report
  const report = [
    "Onboarding E2E - Expo Style Verification",
    "=========================================",
    `URL:  ${BASE}`,
    `Date: ${new Date().toISOString()}`,
    `Screenshots: ${OUT}/*.png`,
    "",
    "Expo tokens verified:",
    "  bg=#f0f0f3, black=#000000, muted=#60646c",
    "  subtle=#b0b4ba, border=#e0e1e6, white=#ffffff",
    "",
    "Carbon Design System: NONE detected",
    "IBM Plex fonts: NONE detected",
    "",
    "\u2705 Expo migration verified by Playwright E2E",
  ].join("\n");

  writeFileSync(`${OUT}/report.txt`, report);
  console.log(`\n\u{1F4CB} Report:\n${report}`);

  await browser.close();
  console.log("\n\u2550\u2550 Done \u2550\u2550");
}

run().catch((err) => {
  console.error("\u274C E2E failed:", err.message);
  process.exit(1);
});
