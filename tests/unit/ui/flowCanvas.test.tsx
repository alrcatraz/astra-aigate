// @vitest-environment jsdom
import "../../_setup/nextIntlDouble";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { FlowCanvas } from "@/shared/components/flow/FlowCanvas";

beforeAll(() => {
  // ReactFlow relies on ResizeObserver, which jsdom does not implement.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const containers: HTMLElement[] = [];

// Every root has to be unmounted inside act before its container leaves the DOM.
// Detaching a live root instead leaves React's scheduler with work queued against
// a torn-down jsdom, which surfaces as an unhandled "window is not defined" from
// react-dom's performWorkOnRootViaSchedulerTask — after this file has finished, so
// it fails the whole Vitest run rather than any one case. A test that renders twice
// also needs every root tracked, not just the newest container.
const mounted: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

function mount(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  mounted.push({ root, el: container });
  act(() => {
    root.render(ui);
  });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  // FlowCanvas queues fitView on a 60ms setTimeout that outlives the test; if it
  // fires after the jsdom environment is torn down it surfaces as an unhandled
  // "window is not defined" (react-dom resolveUpdatePriority) and fails the whole
  // run. Flush the pending timer while the window still exists, then unmount.
  await new Promise((resolve) => setTimeout(resolve, 80));
  act(() => {
    for (const { root } of mounted) root.unmount();
  });
  while (containers.length > 0) {
    containers.pop()?.remove();
  }
  mounted.length = 0;
  document.body.innerHTML = "";
});

const nodes = [
  { id: "a", position: { x: 0, y: 0 }, data: { label: "A" } },
  { id: "b", position: { x: 120, y: 0 }, data: { label: "B" } },
];
const edges = [{ id: "a-b", source: "a", target: "b" }];

describe("FlowCanvas (U0 — shared ReactFlow wrapper)", () => {
  it("renders the canvas with Controls and hides the attribution", () => {
    const container = mount(<FlowCanvas nodes={nodes} edges={edges} fitKey="x" />);
    expect(container.querySelector(".react-flow.omniroute-flow")).toBeTruthy();
    expect(container.querySelector(".react-flow__controls")).toBeTruthy();
    // proOptions.hideAttribution => the attribution element must not render.
    expect(container.querySelector(".react-flow__attribution")).toBeNull();
  });

  it("applies the provided container className for sizing/theming", () => {
    const container = mount(
      <FlowCanvas nodes={nodes} edges={edges} className="omni-test-canvas h-[300px]" />
    );
    expect(container.querySelector(".omni-test-canvas")).toBeTruthy();
  });

  it("themes controls through React Flow variables so library shorthands cannot override them", () => {
    const css = readFileSync(resolve("src/app/globals.css"), "utf8");

    expect(css).toContain(".react-flow.omniroute-flow");
    expect(css).toContain("--xy-controls-button-background-color: var(--color-surface)");
    expect(css).toContain("--xy-controls-button-color: var(--color-text-main)");
    expect(css).toContain("--xy-controls-button-border-color: var(--color-border)");
  });
});
