// @vitest-environment jsdom
import { resolveMessage } from "../../_setup/nextIntlDouble";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// The shell is a thin wrapper that `dynamic()`-imports BurnRateChartInner, so
// the double must render the REAL inner component: a null stub erases the
// component under test (empty <div>) and resolving asynchronously leaves the
// no-data branch unrendered when act() settles.
vi.mock("next/dynamic", async () => {
  const inner =
    await import("../../../src/app/(dashboard)/dashboard/costs/quota-share/components/BurnRateChartInner");
  return { default: () => inner.default };
});

const { default: BurnRateChart } =
  await import("../../../src/app/(dashboard)/dashboard/costs/quota-share/components/BurnRateChart");

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function render(props: Parameters<typeof BurnRateChart>[0]) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(<BurnRateChart {...props} />);
  });
}

describe("BurnRateChart", { timeout: 10000 }, () => {
  afterEach(() => {
    if (root && container) act(() => root!.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("renders no-data state when usage is null", async () => {
    await render({ usage: null });
    expect(document.body.innerHTML).toContain(resolveMessage("quotaShare", "burnRateTitle"));
    expect(document.body.innerHTML).toContain("no data");
  });

  it("renders no-data state when burnRate is falsy", async () => {
    const usage = {
      dimensions: [],
      burnRate: null,
    };
    await render({ usage: usage as never });
    expect(document.body.innerHTML).toContain("no data");
  });

  it("renders chart when usage has burnRate data", async () => {
    const usage = {
      dimensions: [
        { unit: "tokens", window: "daily", limit: 100000, consumedTotal: 30000, perKey: [] },
      ],
      burnRate: { tokensPerSecond: 10, timeToExhaustionMs: 7_000_000 },
    };
    await render({ usage: usage as never });
    // Should not show no-data message
    expect(document.body.innerHTML).not.toContain("no data yet");
    // Should show exhaustion label
    expect(document.body.innerHTML).toContain(resolveMessage("quotaShare", "burnRateExhaustsIn"));
  });
});
