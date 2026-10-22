// @vitest-environment jsdom
/**
 * UI unit test for the AuthzSection wildcard-CORS banner (#5602).
 *
 * The banner must appear when `/api/settings/authz-inventory` reports
 * `cors.allowAll === true` (i.e. `CORS_ALLOW_ALL=true` at runtime) and stay
 * hidden otherwise. It is the only runtime signal a wildcard-CORS
 * misconfiguration is live. See docs/security/CORS.md.
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stable identity fn — the real next-intl `t` is memoized per render. A fresh
// closure each render would flip AuthzSection's `useCallback([t])` dep and loop
// its mount fetch forever, so we return the SAME reference every call.
const translate = (key: string) => key;
vi.mock("next-intl", () => ({
  useTranslations: () => translate,
}));

// Import the (heavy) dashboard component ONCE at module load rather than inside every
// render call. The dynamic import pulls the whole settings-page dependency graph through
// esbuild on first use (~20s cold); doing it per-test made the first test tip over the
// 30s per-test timeout while the second (warm, cached) passed. Hoisting moves that cost to
// module-eval time (outside any per-test timeout) and keeps each test body fast.
const AuthzSection = (
  await import("../../../src/app/(dashboard)/dashboard/settings/components/AuthzSection")
).default;

const cleanupCallbacks: Array<() => void> = [];

// Every root has to be unmounted inside act before its container leaves the DOM.
// Detaching a live root instead leaves React's scheduler with work queued against
// a torn-down jsdom, which surfaces as an unhandled "window is not defined" from
// react-dom's performWorkOnRootViaSchedulerTask — after this file has finished, so
// it fails the whole Vitest run rather than any one case. A test that renders twice
// also needs every root tracked, not just the newest container.
const mounted: Array<{ root: ReturnType<typeof createRoot>; el: HTMLElement }> = [];

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  cleanupCallbacks.push(() => container.remove());
  return container;
}

function inventoryPayload(cors: { allowAll: boolean; allowedOrigins: string[] }) {
  return {
    tiers: [
      {
        name: "PUBLIC",
        prefixes: ["/api/health"],
        description: "public",
        bypassable: false,
      },
    ],
    bypassEnabled: true,
    bypassPrefixes: ["/api/mcp/"],
    spawnCapablePrefixes: ["/api/cli-tools/runtime/"],
    cors,
  };
}

function mockInventoryFetch(cors: { allowAll: boolean; allowedOrigins: string[] }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(inventoryPayload(cors)),
  } as unknown as Response);
}

async function renderAuthzSection(): Promise<HTMLElement> {
  const container = makeContainer();
  const root = createRoot(container);
  mounted.push({ root, el: container });
  await act(async () => {
    root.render(React.createElement(AuthzSection));
  });
  // Flush the mount-time inventory fetch + resulting state update.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

describe("AuthzSection wildcard-CORS banner (#5602)", { timeout: 60000 }, () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      for (const { root } of mounted) root.unmount();
    });
    while (cleanupCallbacks.length > 0) cleanupCallbacks.pop()?.();
    document.body.innerHTML = "";
    mounted.length = 0;
    vi.clearAllMocks();
  });

  it("renders the banner when cors.allowAll is true", async () => {
    mockInventoryFetch({ allowAll: true, allowedOrigins: [] });
    await renderAuthzSection();
    const banner = document.querySelector('[data-testid="cors-wildcard-banner"]');
    expect(banner).not.toBeNull();
  });

  it("does NOT render the banner when cors.allowAll is false", async () => {
    mockInventoryFetch({ allowAll: false, allowedOrigins: ["https://app.example.com"] });
    await renderAuthzSection();
    const banner = document.querySelector('[data-testid="cors-wildcard-banner"]');
    expect(banner).toBeNull();
  });
});
