// @vitest-environment jsdom
// Faithful next-intl double: resolves the real English copy from src/i18n/messages/en.json.
// Must be the first import so the mock is registered before the component is evaluated.
import "../../_setup/nextIntlDouble";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/shared/components", () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

const CONFIG = {
  enabled: true,
  defaultMode: "standard",
  autoTriggerTokens: 0,
  cacheMinutes: 5,
  preserveSystemPrompt: true,
  comboOverrides: {},
  cavemanConfig: {
    enabled: true,
    compressRoles: ["user"],
    skipRules: [],
    minMessageLength: 50,
    preservePatterns: [],
    intensity: "full",
  },
  cavemanOutputMode: { enabled: false, intensity: "full", autoClarity: true },
  rtkConfig: { enabled: true, intensity: "standard" },
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/api/settings/compression")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONFIG) });
      }
      if (u.includes("/api/compression/rules")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ rules: [] }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    })
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderTab() {
  const { default: CompressionSettingsTab } =
    await import("@/app/(dashboard)/dashboard/settings/components/CompressionSettingsTab");
  await act(async () => {
    root = createRoot(container);
    root.render(<CompressionSettingsTab />);
  });
  // Drain the on-mount fetch → json → setState microtask chain.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Writes are debounced by ~400ms (rapid slider edits coalesce into one PUT), so a
 * single setTimeout(0) tick is not enough — poll until the PUT lands or time out.
 */
async function waitForPut(timeoutMs = 3000) {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  const findPut = () =>
    fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
  const start = Date.now();
  while (!findPut()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitForPut timed out");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  return findPut()!;
}

describe("CompressionSettingsTab — compression controls consolidation (T11)", () => {
  it("renders the read-only TokenSaver summary that links to the unified panel", async () => {
    await renderTab();
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/dashboard/context/settings");
    expect(container.textContent).toContain("Token Saver");
  });

  it("does not render a duplicate caveman engine on/off toggle (panel owns on/off)", async () => {
    await renderTab();
    const note = container.querySelector('[data-testid="caveman-panel-note"]');
    expect(note).not.toBeNull();
    // The note points users to the single-source panel...
    expect(note?.textContent).toContain("/dashboard/context/settings");
    // ...and the caveman header no longer carries its own enable toggle button.
    expect(note?.querySelector("button")).toBeNull();
  });

  it("keeps the advanced caveman tuning the panel does not expose", async () => {
    await renderTab();
    const buttonLabels = Array.from(container.querySelectorAll("button")).map((b) =>
      b.textContent?.trim()
    );
    expect(buttonLabels).toContain("User");
    expect(container.textContent).toContain("Skip Compression Rules");
    expect(container.textContent).toContain("Preserve Patterns");
  });

  it("renders the preserveSystemPrompt 3-way mode select reflecting the shim (T05/C5)", async () => {
    await renderTab();
    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="preserve-system-mode-select"]'
    );
    expect(select).not.toBeNull();
    const values = Array.from(select!.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["always", "whenNoCache", "never"]);
    // CONFIG has preserveSystemPrompt: true and no explicit mode → shim renders "always".
    expect(select!.value).toBe("always");
  });

  it("saves the chosen mode via PUT (T05/C5)", async () => {
    await renderTab();
    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="preserve-system-mode-select"]'
    );
    await act(async () => {
      select!.value = "never";
      await select!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const putCall = await waitForPut();
    const body = JSON.parse(String((putCall[1] as RequestInit).body));
    expect(body.preserveSystemPromptMode).toBe("never");
  });
});
