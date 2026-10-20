// @vitest-environment jsdom
// Faithful next-intl double: resolves the real English copy from src/i18n/messages/en.json.
// Must be the first import so the mock is registered before the component is evaluated.
import "../../_setup/nextIntlDouble";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { default: AddApiKeyModal } =
  await import("../../../src/app/(dashboard)/dashboard/providers/[id]/components/modals/AddApiKeyModal");

// Real copy from the `providers` namespace of src/i18n/messages/en.json.
const FREE_TOGGLE = 'button[role="switch"][aria-label="Import only free models"]';
const NAME_PLACEHOLDER = "Production Key";

const containers: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

function render(props: Record<string, unknown>) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <AddApiKeyModal
        isOpen
        onSave={async () => undefined}
        onClose={() => {}}
        {...(props as any)}
      />
    );
  });
  containers.push({ root, el });
  return el;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  // act() must be awaited: a pending async act interleaves act scopes, so the
  // controlled input's state update is not flushed before the next interaction.
  await act(async () => {
    setter.call(input, value);
    await input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: Element) {
  await act(async () => {
    await el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function saveButton(el: HTMLElement) {
  const btn = Array.from(el.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Save"
  );
  if (!btn) throw new Error("save button not rendered");
  return btn;
}

async function waitFor(fn: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: true }) } as Response)
    )
  );
});

afterEach(() => {
  for (const { root, el } of containers.splice(0)) {
    act(() => root.unmount());
    el.remove();
  }
  vi.unstubAllGlobals();
});

describe("AddApiKeyModal — import only free models", () => {
  it("shows the free-only toggle for a provider that has free models", () => {
    const el = render({ provider: "openrouter", providerName: "OpenRouter" });
    expect(el.querySelector(FREE_TOGGLE)).toBeTruthy();
  });

  it("hides the free-only toggle for a provider without free models", () => {
    const el = render({ provider: "anthropic", providerName: "Anthropic" });
    // The form still renders; only the free-models toggle is absent.
    expect(el.querySelector(`input[placeholder="${NAME_PLACEHOLDER}"]`)).toBeTruthy();
    expect(el.querySelector(FREE_TOGGLE)).toBeNull();
  });

  it("includes importFreeModelsOnly in the saved payload when toggled on", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const el = render({ provider: "openrouter", providerName: "OpenRouter", onSave });

    const nameInput = el.querySelector<HTMLInputElement>(
      `input[placeholder="${NAME_PLACEHOLDER}"]`
    )!;
    const apiKeyInput = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    await setInputValue(nameInput, "My OpenRouter");
    await setInputValue(apiKeyInput, "test-openrouter-credential");

    const toggle = el.querySelector<HTMLButtonElement>(FREE_TOGGLE)!;
    await click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await click(saveButton(el));

    await waitFor(() => onSave.mock.calls.length > 0);
    const payload = onSave.mock.calls[0][0];
    expect(payload.providerSpecificData?.importFreeModelsOnly).toBe(true);
  });
});

describe("AddApiKeyModal — quota scraping fields", () => {
  it("saves OpenCode Go workspace and auth cookie in providerSpecificData", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const el = render({ provider: "opencode-go", providerName: "OpenCode Go", onSave });

    const nameInput = el.querySelector<HTMLInputElement>(
      `input[placeholder="${NAME_PLACEHOLDER}"]`
    )!;
    const apiKeyInput = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    const workspaceInput = el.querySelector<HTMLInputElement>(
      'input[name="opencodeGoWorkspaceId"]'
    );
    const cookieInput = el.querySelector<HTMLInputElement>('input[name="opencodeGoAuthCookie"]');
    expect(workspaceInput).toBeTruthy();
    expect(cookieInput).toBeTruthy();

    await setInputValue(nameInput, "OpenCode Go");
    await setInputValue(apiKeyInput, "test-opencode-go-credential");
    await setInputValue(workspaceInput!, "workspace-123");
    await setInputValue(cookieInput!, "auth=opencode-cookie");

    await click(saveButton(el));

    await waitFor(() => onSave.mock.calls.length > 0);
    const payload = onSave.mock.calls[0][0];
    expect(payload.providerSpecificData?.opencodeGoWorkspaceId).toBe("workspace-123");
    expect(payload.providerSpecificData?.opencodeGoAuthCookie).toBe("auth=opencode-cookie");
  });

  it("saves Ollama Cloud usage cookie in providerSpecificData", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const el = render({ provider: "ollama-cloud", providerName: "Ollama Cloud", onSave });

    const nameInput = el.querySelector<HTMLInputElement>(
      `input[placeholder="${NAME_PLACEHOLDER}"]`
    )!;
    const apiKeyInput = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    const cookieInput = el.querySelector<HTMLInputElement>('input[name="ollamaCloudUsageCookie"]');
    expect(cookieInput).toBeTruthy();

    await setInputValue(nameInput, "Ollama Cloud");
    await setInputValue(apiKeyInput, "ollama-key");
    await setInputValue(cookieInput!, "__Secure-session=ollama-cookie");

    await click(saveButton(el));

    await waitFor(() => onSave.mock.calls.length > 0);
    const payload = onSave.mock.calls[0][0];
    expect(payload.providerSpecificData?.ollamaCloudUsageCookie).toBe(
      "__Secure-session=ollama-cookie"
    );
  });
});
