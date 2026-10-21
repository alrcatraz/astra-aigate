// @vitest-environment jsdom
import "../../_setup/nextIntlDouble";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ResponseValidationEditor,
  type ResponseValidationValue,
} from "@/app/(dashboard)/dashboard/combos/ResponseValidationEditor";

// Feature 4985 — the per-combo response-validation editor emits the declarative shape.

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

async function render(value: ResponseValidationValue | undefined, onChange: (v: unknown) => void) {
  await act(async () => {
    root = createRoot(container);
    root.render(<ResponseValidationEditor value={value} onChange={onChange} />);
  });
}

function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, text);
}

async function setTextarea(testid: string, text: string) {
  const el = container.querySelector<HTMLTextAreaElement>(`[data-testid="${testid}"]`);
  expect(el).not.toBeNull();
  await act(async () => {
    setNativeValue(el!, text);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
    // React 19 batches the change into a queued render; give it a tick so the
    // controlled value and the emit() call both settle before assertions.
    await Promise.resolve();
  });
}

async function click(testid: string) {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  expect(el).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ResponseValidationEditor (4985)", () => {
  it("turns forbidden-substring lines into an array (trimmed, no blanks)", async () => {
    const onChange = vi.fn();
    await render(undefined, onChange);
    await setTextarea("rv-forbidden", "I cannot help\n\n  as an AI  \n");
    expect(onChange).toHaveBeenLastCalledWith({
      forbiddenSubstrings: ["I cannot help", "as an AI"],
    });
  });

  it("clears the whole config back to undefined when every field is emptied", async () => {
    const onChange = vi.fn();
    await render({ forbiddenSubstrings: ["x"] }, onChange);
    await setTextarea("rv-forbidden", "");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("adds a json-path predicate row with sane defaults", async () => {
    const onChange = vi.fn();
    await render(undefined, onChange);
    await click("rv-predicate-add");
    expect(onChange).toHaveBeenLastCalledWith({
      jsonPathPredicates: [{ path: "", condition: "exists" }],
    });
  });

  it("renders existing predicate rows from the value", async () => {
    await render(
      { jsonPathPredicates: [{ path: "choices[0].message.content", condition: "nonEmpty" }] },
      vi.fn()
    );
    const rows = container.querySelectorAll('[data-testid="rv-predicate-row"]');
    expect(rows.length).toBe(1);
    const pathInput = container.querySelector<HTMLInputElement>(
      '[data-testid="rv-predicate-path"]'
    );
    expect(pathInput?.value).toBe("choices[0].message.content");
  });
});
