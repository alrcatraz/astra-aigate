// @vitest-environment jsdom
import "../../_setup/nextIntlDouble";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
}));

vi.mock("@/shared/hooks", () => ({
  useDisplayBaseUrl: () => "https://api.example.com",
}));

const { default: OnboardingWizard } =
  await import("../../../src/app/(dashboard)/dashboard/onboarding/page");

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

async function waitForText(text: string): Promise<void> {
  await waitFor(() => container.textContent?.includes(text) === true, `text: ${text}`);
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label
  );
}

async function waitForButton(label: string): Promise<HTMLButtonElement> {
  await waitFor(() => findButton(label) !== undefined, `button: ${label}`);
  return findButton(label)!;
}

async function clickButton(label: string): Promise<void> {
  const button = await waitForButton(label);
  await act(async () => {
    button.click();
  });
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  pushMock.mockReset();
  replaceMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Fresh install: the wizard must stay mounted instead of bouncing to /login.
      if (url === "/api/settings/require-login") {
        return jsonResponse({ requireLogin: false, setupComplete: false, apiPort: 20131 });
      }
      if (url === "/api/settings") {
        return jsonResponse({ setupComplete: false, apiPort: 20131 });
      }
      if (url === "/api/v1/provider") {
        return jsonResponse({ success: true });
      }
      if (url === "/api/v1/health/models") {
        return jsonResponse({ data: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("renders the public API URL instead of rebuilding an internal apiPort URL", async () => {
  await act(async () => {
    root.render(<OnboardingWizard />);
  });

  // Walk the real wizard: welcome → tiers → security → provider → test → done.
  await clickButton("Get Started");
  await clickButton("Continue");

  // Security step: tick the skip checkbox so Continue is enabled without a password.
  const skipSecurity = container.querySelector("input[type='checkbox']") as HTMLInputElement;
  expect(skipSecurity).not.toBeNull();
  await act(async () => {
    skipSecurity.click();
  });
  await clickButton("Continue");

  // Provider step: pick a provider card, fill the API key, submit.
  await waitForButton("OpenAI");
  await act(async () => {
    findButton("OpenAI")!.click();
  });
  const apiKeyInput = container.querySelector(
    "input[placeholder='API Key (required)']"
  ) as HTMLInputElement;
  expect(apiKeyInput).not.toBeNull();
  await setInputValue(apiKeyInput, "sk-test");
  await clickButton("Add your first provider");

  await clickButton("Run Connection Test");
  await clickButton("Continue");

  await waitForText("Your endpoint:");
  expect(container.textContent).toContain("https://api.example.com/api/v1");
  expect(container.textContent).not.toContain(":20131/api/v1");
  expect(replaceMock).not.toHaveBeenCalled();
});
