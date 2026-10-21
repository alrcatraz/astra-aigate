// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import CompressionStudioPage from "@/app/(dashboard)/dashboard/compression/studio/page";
import ComboLiveStudioPage from "@/app/(dashboard)/dashboard/combos/live/page";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../src/i18n/messages/en.json";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // The live hooks may construct a WebSocket; a no-op keeps the smoke test offline.
  globalThis.WebSocket = class {
    readyState = 0;
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  } as unknown as typeof WebSocket;
});

// Every root has to be unmounted inside act before its container leaves the DOM.
// Detaching a live root instead leaves React's scheduler with work queued against
// a torn-down jsdom, which surfaces as an unhandled "window is not defined" from
// react-dom's performWorkOnRootViaSchedulerTask — after this file has finished, so
// it fails the whole Vitest run rather than any one case. A test that renders twice
// also needs every root tracked, not just the newest container.
const mounted: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

const containers: HTMLElement[] = [];

function mount(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  mounted.push({ root, el: container });
  act(() => {
    // Both pages read copy through next-intl; the app shell that normally
    // provides it does not exist under jsdom.
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {ui}
      </NextIntlClientProvider>
    );
  });
  return container;
}

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
  while (containers.length > 0) containers.pop()?.remove();
  document.body.innerHTML = "";
});

describe("Studio route pages (Tela A / Tela B wiring)", () => {
  it("Compression Studio page mounts and shows the Play tab by default", () => {
    const container = mount(<CompressionStudioPage />);
    expect(container.querySelector('[data-testid="play-input"]')).toBeTruthy();
  });

  it("Combo Live Studio page mounts the studio shell without live data", () => {
    const container = mount(<ComboLiveStudioPage />);
    expect(container.querySelector('[data-testid="combo-live-studio"]')).toBeTruthy();
  });
});
