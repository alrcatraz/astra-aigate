// @vitest-environment jsdom
// Faithful next-intl double: resolves the real English copy from src/i18n/messages/en.json.
// Must be the first import so the mock is registered before the component is evaluated.
import "../../_setup/nextIntlDouble";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "openrouter" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { default: EditConnectionModal } =
  await import("../../../src/app/(dashboard)/dashboard/providers/[id]/components/modals/EditConnectionModal");

// Real copy from the `providers` namespace of src/i18n/messages/en.json.
const FREE_TOGGLE = 'button[role="switch"][aria-label="Import only free models"]';

const containers: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

function render(props: Record<string, unknown>) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <EditConnectionModal
        isOpen
        providerId={(props.providerId as string) || "openrouter"}
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
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({}), text: async () => "" } as Response)
    )
  );
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  });
});

afterEach(() => {
  for (const { root, el } of containers.splice(0)) {
    act(() => root.unmount());
    el.remove();
  }
  vi.unstubAllGlobals();
});

describe("EditConnectionModal — import only free models", () => {
  it("shows the free-only toggle for a connection whose provider has free models", () => {
    const el = render({
      connection: { id: "conn-1", provider: "openrouter", providerSpecificData: {} },
    });
    expect(el.querySelector(FREE_TOGGLE)).toBeTruthy();
  });

  it("hides the free-only toggle for a provider without free models", () => {
    const el = render({
      providerId: "anthropic",
      connection: { id: "conn-2", provider: "anthropic", providerSpecificData: {} },
    });
    // The modal still renders its form; only the free-models toggle is absent.
    expect(el.querySelector("button")).toBeTruthy();
    expect(el.querySelector(FREE_TOGGLE)).toBeNull();
  });

  it("reflects the persisted flag as initially checked", () => {
    const el = render({
      connection: {
        id: "conn-3",
        provider: "openrouter",
        providerSpecificData: { importFreeModelsOnly: true },
      },
    });
    expect(el.querySelector(FREE_TOGGLE)!.getAttribute("aria-checked")).toBe("true");
  });

  it("clears the flag (explicit false) and re-syncs when toggled off", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onResyncModels = vi.fn().mockResolvedValue(undefined);
    const el = render({
      connection: {
        id: "conn-5",
        provider: "openrouter",
        name: "OR",
        providerSpecificData: { importFreeModelsOnly: true },
      },
      onSave,
      onResyncModels,
    });

    const toggle = el.querySelector<HTMLButtonElement>(FREE_TOGGLE)!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await click(toggle);
    expect(el.querySelector<HTMLButtonElement>(FREE_TOGGLE)!.getAttribute("aria-checked")).toBe(
      "false"
    );

    await click(saveButton(el));

    await waitFor(() => onSave.mock.calls.length > 0);
    // Must be an explicit `false`, not `undefined` — otherwise the PUT merge keeps the old `true`.
    expect(onSave.mock.calls[0][0].providerSpecificData?.importFreeModelsOnly).toBe(false);
    await waitFor(() => onResyncModels.mock.calls.length > 0);
    expect(onResyncModels).toHaveBeenCalledWith("conn-5");
  });

  it("saves the flag and triggers a re-sync when toggled on", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onResyncModels = vi.fn().mockResolvedValue(undefined);
    const el = render({
      connection: { id: "conn-4", provider: "openrouter", name: "OR", providerSpecificData: {} },
      onSave,
      onResyncModels,
    });

    const toggle = el.querySelector<HTMLButtonElement>(FREE_TOGGLE)!;
    await click(toggle);

    await click(saveButton(el));

    await waitFor(() => onSave.mock.calls.length > 0);
    const payload = onSave.mock.calls[0][0];
    expect(payload.providerSpecificData?.importFreeModelsOnly).toBe(true);

    await waitFor(() => onResyncModels.mock.calls.length > 0);
    expect(onResyncModels).toHaveBeenCalledWith("conn-4");
  });
});

describe("EditConnectionModal — quota scraping fields", () => {
  it("saves OpenCode Go workspace and replacement auth cookie", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const el = render({
      providerId: "opencode-go",
      connection: {
        id: "conn-opencode-go",
        provider: "opencode-go",
        name: "OpenCode Go",
        authType: "apikey",
        providerSpecificData: { workspaceId: "workspace-existing" },
      },
      onSave,
    });

    const workspaceInput = el.querySelector<HTMLInputElement>(
      'input[name="opencodeGoWorkspaceId"]'
    );
    const cookieInput = el.querySelector<HTMLInputElement>('input[name="opencodeGoAuthCookie"]');
    expect(workspaceInput).toBeTruthy();
    expect(cookieInput).toBeTruthy();
    expect(workspaceInput!.value).toBe("workspace-existing");
    await setInputValue(workspaceInput!, "workspace-updated");
    await setInputValue(cookieInput!, "auth=opencode-cookie");

    await click(saveButton(el));

    await waitFor(() => onSave.mock.calls.length > 0);
    const payload = onSave.mock.calls[0][0];
    expect(payload.providerSpecificData?.opencodeGoWorkspaceId).toBe("workspace-updated");
    expect(payload.providerSpecificData?.opencodeGoAuthCookie).toBe("auth=opencode-cookie");
  });

  it("omits Ollama Cloud usage cookie when the edit field is left blank", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const el = render({
      providerId: "ollama-cloud",
      connection: {
        id: "conn-ollama-cloud",
        provider: "ollama-cloud",
        name: "Ollama Cloud",
        authType: "apikey",
        providerSpecificData: {},
      },
      onSave,
    });

    expect(el.querySelector<HTMLInputElement>('input[name="ollamaCloudUsageCookie"]')).toBeTruthy();

    await click(saveButton(el));

    await waitFor(() => onSave.mock.calls.length > 0);
    const payload = onSave.mock.calls[0][0];
    expect("ollamaCloudUsageCookie" in payload.providerSpecificData).toBe(false);
  });
});
