// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanupCallbacks: Array<() => void> = [];

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  cleanupCallbacks.push(() => container.remove());
  return container;
}

describe("MitmProxyError boundary", () => {
  // Every root has to be unmounted inside act before its container leaves the DOM.
  // Detaching a live root instead leaves React's scheduler with work queued against
  // a torn-down jsdom, which surfaces as an unhandled "window is not defined" from
  // react-dom's performWorkOnRootViaSchedulerTask — after this file has finished, so
  // it fails the whole Vitest run rather than any one case. A test that renders twice
  // also needs every root tracked, not just the newest container.
  const mounted: Array<{ root: ReturnType<typeof createRoot>; el: HTMLElement }> = [];

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      for (const { root } of mounted) root.unmount();
    });
    for (const { el } of mounted) el.remove();
    mounted.length = 0;
    while (cleanupCallbacks.length > 0) cleanupCallbacks.pop()?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders a recoverable fallback instead of throwing", async () => {
    const { default: MitmProxyError } =
      await import("../../../src/app/(dashboard)/dashboard/system/mitm-proxy/error");
    const container = makeContainer();
    const root = createRoot(container);
    mounted.push({ root, el: container });
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "abc123" });

    await act(async () => {
      root.render(<MitmProxyError error={error} reset={reset} />);
    });

    expect(container.querySelector("[role='alert']")).toBeTruthy();
    expect(container.textContent).toContain("Failed to load MITM proxy");
  });

  it("calls reset() exactly once when Try Again is clicked", async () => {
    const { default: MitmProxyError } =
      await import("../../../src/app/(dashboard)/dashboard/system/mitm-proxy/error");
    const container = makeContainer();
    const root = createRoot(container);
    mounted.push({ root, el: container });
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: undefined });

    await act(async () => {
      root.render(<MitmProxyError error={error} reset={reset} />);
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Try Again"
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();

    await act(async () => {
      button?.click();
    });

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
