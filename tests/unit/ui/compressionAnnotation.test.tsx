// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompressionAnnotation } from "@/app/(dashboard)/dashboard/compression/studio/CompressionAnnotation";
import type { CompressionStats } from "@omniroute/open-sse/services/compression/types";

let container: HTMLDivElement;

// Every root has to be unmounted inside act before its container leaves the DOM.
// Detaching a live root instead leaves React's scheduler with work queued against
// a torn-down jsdom, which surfaces as an unhandled "window is not defined" from
// react-dom's performWorkOnRootViaSchedulerTask — after this file has finished, so
// it fails the whole Vitest run rather than any one case. A test that renders twice
// also needs every root tracked, not just the newest container.
const mounted: Array<{ root: ReturnType<typeof createRoot>; el: HTMLElement }> = [];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    for (const { root } of mounted) root.unmount();
  });
  for (const { el } of mounted) el.remove();
  mounted.length = 0;
  // The tracked el.remove() above already detached the container; plain remove()
  // is idempotent where removeChild() would now throw NotFoundError.
  container.remove();
});

function render(ui: React.ReactElement) {
  const root = createRoot(container);
  mounted.push({ root, el: container });
  act(() => {
    root.render(ui);
  });
}

function makeStats(overrides: Partial<CompressionStats> = {}): CompressionStats {
  return {
    originalTokens: 847,
    compressedTokens: 312,
    savingsPercent: 63.16,
    techniquesUsed: ["caveman"],
    mode: "standard",
    timestamp: 0,
    ...overrides,
  };
}

describe("CompressionAnnotation", () => {
  it("renders token range badge", () => {
    const stats = makeStats({
      rulesApplied: ["filler", "filler", "dedup"],
    });
    render(<CompressionAnnotation stats={stats} />);
    expect(container.textContent).toContain("847→312");
  });

  it("renders rule pills", () => {
    const stats = makeStats({
      rulesApplied: ["filler", "filler", "dedup"],
    });
    render(<CompressionAnnotation stats={stats} />);
    expect(container.textContent).toContain("filler×2");
    expect(container.textContent).toContain("dedup×1");
  });

  it("returns null when no rules applied", () => {
    const stats = makeStats({ rulesApplied: [], techniquesUsed: [] });
    render(<CompressionAnnotation stats={stats} />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when rulesApplied is absent", () => {
    const stats = makeStats({ rulesApplied: undefined, techniquesUsed: [] });
    render(<CompressionAnnotation stats={stats} />);
    expect(container.innerHTML).toBe("");
  });
});
