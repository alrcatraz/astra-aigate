// @vitest-environment jsdom
import "../../_setup/nextIntlDouble";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, afterEach } from "vitest";

const { ModelVisibilityToolbar } =
  await import("../../../src/app/(dashboard)/dashboard/providers/[id]/components/ModelRow");

// providerText() falls back to the English string when t.has(key) is false.
const t: any = Object.assign((k: string) => k, { has: () => false });

const containers: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

async function render(extra: Record<string, unknown>) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <ModelVisibilityToolbar
        t={t}
        filterValue=""
        onFilterChange={() => {}}
        activeCount={0}
        totalCount={0}
        onSelectAll={() => {}}
        onDeselectAll={() => {}}
        {...(extra as any)}
      />
    );
  });
  containers.push({ root, el });
  return el;
}

const byText = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

const byTextIncludes = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(text));

afterEach(() => {
  for (const { root, el } of containers.splice(0)) {
    act(() => root.unmount());
    el.remove();
  }
});

describe("ModelVisibilityToolbar — free filter & sort", () => {
  it("does not render free-filter or sort controls when their props are absent", async () => {
    const el = await render({});
    expect(byText(el, "Free only")).toBeUndefined();
    expect(byTextIncludes(el, "Free first")).toBeUndefined();
  });

  it("renders All / Free only / Paid only when freeFilter props are provided", async () => {
    const el = await render({ freeFilter: "all", onFreeFilterChange: () => {} });
    expect(byText(el, "Free only")).toBeTruthy();
    expect(byText(el, "Paid only")).toBeTruthy();
  });

  it("fires onFreeFilterChange with the chosen filter", async () => {
    const onFreeFilterChange = vi.fn();
    const el = await render({ freeFilter: "all", onFreeFilterChange });
    await act(async () => {
      byText(el, "Free only")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFreeFilterChange).toHaveBeenCalledWith("free");
    await act(async () => {
      byText(el, "Paid only")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFreeFilterChange).toHaveBeenCalledWith("paid");
  });

  it("toggles sort free-first", async () => {
    const onSortFreeFirstChange = vi.fn();
    const el = await render({ sortFreeFirst: false, onSortFreeFirstChange });
    const btn = byTextIncludes(el, "Free first")!;
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSortFreeFirstChange).toHaveBeenCalledWith(true);
  });
});
