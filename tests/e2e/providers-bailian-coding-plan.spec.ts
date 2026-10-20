import { expect, test, type Page } from "@playwright/test";
import { gotoDashboardRoute } from "./helpers/dashboardAuth";

// When the credential modal does not appear, a bare "element(s) not found" is
// undiagnosable from CI: it could be a different accessible name, a different
// dialog, or the click having opened nothing at all. Report what the page
// actually offers so one CI log is enough to fix the locator.
async function describeDialogs(page: Page): Promise<string> {
  const dialogs = page.getByRole("dialog");
  const n = await dialogs.count();
  const seen: string[] = [];
  for (let i = 0; i < Math.min(n, 5); i++) {
    const d = dialogs.nth(i);
    const label = await d.getAttribute("aria-label").catch(() => null);
    const text = (await d.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
    seen.push(`[${i}] ariaLabel=${JSON.stringify(label)} text=${JSON.stringify(text)}`);
  }
  const buttons = (await page.getByRole("button").allInnerTexts())
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 20);
  const urlFields = await page.getByLabel(/url/i).count();
  const dialogButtons =
    n > 0
      ? (await dialogs.first().getByRole("button").allInnerTexts())
          .map((s) => s.trim().replace(/\s+/g, " "))
          .filter(Boolean)
      : [];
  const dialogInputs = n > 0 ? await dialogs.first().locator("input").count() : 0;
  const dialogLabels =
    n > 0 ? (await dialogs.first().locator("label").allInnerTexts()).map((s) => s.trim()) : [];
  const dialogText =
    n > 0
      ? (
          await dialogs
            .first()
            .innerText()
            .catch(() => "")
        )
          .replace(/\s+/g, " ")
          .slice(0, 400)
      : "";
  return (
    `dialogs=${n} {${seen.join(" | ")}} urlLabelledInputs=${urlFields} ` +
    `buttons=${JSON.stringify(buttons)} dialogButtons=${JSON.stringify(dialogButtons)} ` +
    `dialogInputs=${dialogInputs} dialogLabels=${JSON.stringify(dialogLabels)} ` +
    `dialogText=${JSON.stringify(dialogText)}`
  );
}

const DEFAULT_BAILIAN_URL = "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1";

test.describe("Bailian Coding Plan Provider", () => {
  test.describe.configure({ mode: "serial" });

  test("default URL visible and editable in Add API Key modal", async ({ page }) => {
    const capturedPayloads: { createProvider?: Record<string, unknown> } = {};

    await page.route("**/api/providers", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ connections: [] }),
        });
        return;
      }

      if (method === "POST") {
        const payload = route.request().postDataJSON();
        capturedPayloads.createProvider = payload;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            connection: {
              id: "conn-bailian-test",
              provider: "bailian-coding-plan",
              name: payload.name || "Test Connection",
              testStatus: "active",
              providerSpecificData: payload.providerSpecificData,
            },
          }),
        });
        return;
      }

      await route.fulfill({ status: 405 });
    });

    await page.route("**/api/providers/validate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ valid: true }),
      });
    });

    await page.route("**/api/provider-nodes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ nodes: [] }),
      });
    });

    await gotoDashboardRoute(page, "/dashboard/providers/bailian-coding-plan");
    await page.waitForLoadState("domcontentloaded");

    // Dismiss any pre-existing dialog/overlay that may appear on page load
    const preExistingDialog = page.getByRole("dialog").first();
    if (await preExistingDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
      await preExistingDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    }

    const addKeyButton = page.getByRole("button", {
      name: /add.*api.*key|add.*key|add.*connection|connect|adicionar.*chave/i,
    });

    // Wait for the button to appear instead of immediately checking visibility
    await addKeyButton.first().waitFor({ state: "visible", timeout: 15000 });
    await expect(addKeyButton.first()).toBeEnabled({ timeout: 5000 });
    await addKeyButton.first().click();

    // The modal's accessible name is "Add Connection · Alibaba Token Plan" (read off
    // the rendered dialog in jsdom, not inferred from the title helper), and the page
    // can carry other role=dialog nodes, so locate it by name rather than by position.
    const dialog = page.getByRole("dialog", { name: /add connection/i });
    try {
      await expect(dialog).toBeVisible({ timeout: 10000 });
    } catch (err) {
      throw new Error(
        `${(err as Error).message}\n--- page report ---\n${await describeDialogs(page)}`
      );
    }

    // This provider opens on Alibaba's region chooser; the credential fields (Name,
    // API Key, Validation Model, Priority, Base URL) only render once a region is
    // picked — asserting them straight after opening is what failed, with no field in
    // the DOM yet. Singapore is the international endpoint the default URL points at.
    await dialog.getByRole("button", { name: /singapore/i }).click();

    // The shared Input wires its label to the field via htmlFor/useId, so getByLabel
    // is exact; the old `.or(…)` fallback hopped with `locator("..")`, which is not a
    // valid relative selector here and could never match anything.
    const baseUrlInput = dialog.getByLabel(/base.*url/i);

    try {
      await expect(baseUrlInput).toBeVisible({ timeout: 15000 });
    } catch (err) {
      throw new Error(
        `${(err as Error).message}\n--- page report (after selecting a region) ---\n${await describeDialogs(page)}`
      );
    }

    const inputValue = await baseUrlInput.inputValue();
    expect(inputValue).toBe(DEFAULT_BAILIAN_URL);

    const nameInput = dialog.getByLabel(/name/i).or(dialog.locator("input").first());
    await nameInput.fill("Test Bailian Connection");

    const apiKeyInput = dialog
      .getByLabel(/api.*key/i)
      .or(dialog.locator('input[type="password"]').first());
    await apiKeyInput.fill("test-api-key-12345");

    const customUrl = "https://custom.example.com/anthropic/v1";
    await baseUrlInput.fill(customUrl);

    const saveButton = dialog
      .getByRole("button", {
        name: /save|add|create|connect/i,
      })
      .last();
    await expect(saveButton).toBeEnabled({ timeout: 15000 });
    await saveButton.click();

    await expect(dialog)
      .toBeHidden({ timeout: 10000 })
      .catch(() => undefined);

    expect(capturedPayloads.createProvider).toBeDefined();
    const payload = capturedPayloads.createProvider;
    expect(payload?.providerSpecificData).toBeDefined();
    expect((payload?.providerSpecificData as Record<string, unknown>)?.baseUrl).toBe(customUrl);
  });

  test("invalid URL blocks save with validation error", async ({ page }) => {
    let createAttempted = false;

    await page.route("**/api/providers", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ connections: [] }),
        });
        return;
      }

      if (method === "POST") {
        createAttempted = true;
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Invalid request",
            details: [
              {
                field: "providerSpecificData.baseUrl",
                message: "providerSpecificData.baseUrl must be a valid URL",
              },
            ],
          }),
        });
        return;
      }

      await route.fulfill({ status: 405 });
    });

    await page.route("**/api/providers/validate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ valid: true }),
      });
    });

    await page.route("**/api/provider-nodes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ nodes: [] }),
      });
    });

    await gotoDashboardRoute(page, "/dashboard/providers/bailian-coding-plan");
    await page.waitForLoadState("domcontentloaded");

    // Dismiss any pre-existing dialog/overlay that may appear on page load
    const preExistingDialog = page.getByRole("dialog").first();
    if (await preExistingDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
      await preExistingDialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    }

    const addKeyButton = page.getByRole("button", {
      name: /add.*api.*key|add.*key|add.*connection|connect|adicionar.*chave/i,
    });

    // Wait for the button to appear instead of immediately checking visibility
    await addKeyButton.first().waitFor({ state: "visible", timeout: 15000 });
    await expect(addKeyButton.first()).toBeEnabled({ timeout: 5000 });
    await addKeyButton.first().click();

    // The modal's accessible name is "Add Connection · Alibaba Token Plan" (read off
    // the rendered dialog in jsdom, not inferred from the title helper), and the page
    // can carry other role=dialog nodes, so locate it by name rather than by position.
    const dialog = page.getByRole("dialog", { name: /add connection/i });
    try {
      await expect(dialog).toBeVisible({ timeout: 10000 });
    } catch (err) {
      throw new Error(
        `${(err as Error).message}\n--- page report ---\n${await describeDialogs(page)}`
      );
    }

    // This provider opens on Alibaba's region chooser; the credential fields (Name,
    // API Key, Validation Model, Priority, Base URL) only render once a region is
    // picked — asserting them straight after opening is what failed, with no field in
    // the DOM yet. Singapore is the international endpoint the default URL points at.
    await dialog.getByRole("button", { name: /singapore/i }).click();

    // The shared Input wires its label to the field via htmlFor/useId, so getByLabel
    // is exact; the old `.or(…)` fallback hopped with `locator("..")`, which is not a
    // valid relative selector here and could never match anything.
    const baseUrlInput = dialog.getByLabel(/base.*url/i);
    try {
      await expect(baseUrlInput).toBeVisible({ timeout: 15000 });
    } catch (err) {
      throw new Error(
        `${(err as Error).message}\n--- page report (after selecting a region) ---\n${await describeDialogs(page)}`
      );
    }

    const nameInput = dialog.getByLabel(/name/i).or(dialog.locator("input").first());
    await nameInput.fill("Test Invalid URL Connection");

    const apiKeyInput = dialog
      .getByLabel(/api.*key/i)
      .or(dialog.locator('input[type="password"]').first());
    await apiKeyInput.fill("test-api-key-12345");

    await baseUrlInput.fill("not-a-url");

    const saveButton = dialog
      .getByRole("button", {
        name: /save|add|create|connect/i,
      })
      .last();
    await saveButton.click();

    // Wait for React to process the validation and re-render
    await page.waitForTimeout(1000);

    // Check for the validation error scoped to the dialog to avoid strict-mode
    // violations from broad selectors matching unrelated page elements.
    const errorTextLocator = dialog
      .locator("text=/invalid.*url|url.*invalid|must be a valid url|must use http/i")
      .first();
    const errorClassLocator = dialog.locator(".text-red-500").first();

    let errorVisible =
      (await errorTextLocator.isVisible().catch(() => false)) ||
      (await errorClassLocator.isVisible().catch(() => false));

    if (!errorVisible) {
      // Fallback: if the dialog stays open after clicking save, it means the
      // client-side validation prevented submission (which is the desired behavior).
      await page.waitForTimeout(2000);
      errorVisible = await dialog.isVisible().catch(() => false);
    }

    expect(errorVisible).toBe(true);
    expect(createAttempted).toBe(false);
  });
});
