// @vitest-environment jsdom
import { resolveMessage } from "../../_setup/nextIntlDouble";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { DEFAULT_PARAMS } =
  await import("../../../src/app/(dashboard)/dashboard/playground/components/ParamSliders");
const { default: ImprovePromptButton } =
  await import("../../../src/app/(dashboard)/dashboard/playground/components/ImprovePromptButton");

// The shared next-intl double returns `t.rich()` as plain text, so the `<model>`
// tag in `improvePromptDescription` comes out as an empty element and the
// configured model name never reaches the DOM. The component renders the model
// through that tag, so give this file's (cached, stable) translator the same
// `<tag>…</tag>` handling real next-intl provides.
type RichValues = Record<string, unknown>;
type PlaygroundTranslator = ((key: string) => string) & {
  raw: (key: string) => string;
  rich: (key: string, values?: RichValues) => React.ReactNode;
};

// Built straight from the message catalogue rather than by calling the hook at
// module scope: `useTranslations` is a React hook, and invoking it outside a
// component is both a lint error and a false claim about how the component
// resolves its copy.
const playgroundT = ((key: string) =>
  resolveMessage("playground", key) ?? key) as PlaygroundTranslator;
playgroundT.raw = (key: string) => resolveMessage("playground", key) ?? key;
playgroundT.rich = (key, values = {}) => {
  // Interpolate scalars first: the catalogue stores the confirmation as
  // "… <model>{model}</model> …", so without this the tag renders its own
  // placeholder text instead of the configured model name.
  const template = (playgroundT.raw(key) ?? key).replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return typeof value === "string" || typeof value === "number" ? String(value) : whole;
  });
  const nodes: React.ReactNode[] = [];
  const tagRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = tagRe.exec(template)) !== null) {
    if (match.index > cursor) nodes.push(template.slice(cursor, match.index));
    const renderTag = values[match[1]];
    const inner = match[2] || undefined;
    nodes.push(
      typeof renderTag === "function"
        ? (renderTag as (children?: React.ReactNode) => React.ReactNode)(inner)
        : inner
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < template.length) nodes.push(template.slice(cursor));

  return React.createElement(React.Fragment, null, ...nodes);
};

const BASE_CONFIG = {
  endpoint: "chat.completions" as const,
  baseUrl: "http://localhost:20128",
  model: "openai/gpt-4o",
  systemPrompt: "You are helpful.",
  params: { ...DEFAULT_PARAMS },
};

const containers: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

function renderButton(config = BASE_CONFIG, setConfig = vi.fn()): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<ImprovePromptButton configState={config} setConfigState={setConfig} />);
  });
  containers.push({ root, el });
  return el;
}

afterEach(() => {
  for (const { root, el } of containers) {
    act(() => root.unmount());
    el.remove();
  }
  containers.length = 0;
  vi.restoreAllMocks();
});

describe("ImprovePromptButton", () => {
  it("renders the Improve prompt button", () => {
    const el = renderButton();
    const btn = el.querySelector("[aria-label='Improve prompt using AI']");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain("Improve prompt");
  });

  it("button is disabled when model is empty", () => {
    const config = { ...BASE_CONFIG, model: "" };
    const el = renderButton(config);
    const btn = el.querySelector("[aria-label='Improve prompt using AI']") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("button is enabled when model is set", () => {
    const el = renderButton();
    const btn = el.querySelector("[aria-label='Improve prompt using AI']") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("shows confirmation modal when button is clicked", async () => {
    const el = renderButton();
    const btn = el.querySelector("[aria-label='Improve prompt using AI']") as HTMLButtonElement;

    await act(async () => {
      btn.click();
    });

    const modal = el.querySelector("[role='dialog']");
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain("Improve prompt");
  });

  it("confirmation modal shows quota warning message", async () => {
    const el = renderButton();
    const btn = el.querySelector("[aria-label='Improve prompt using AI']") as HTMLButtonElement;

    await act(async () => {
      btn.click();
    });

    const modal = el.querySelector("[role='dialog']");
    expect(modal?.textContent).toContain("quota");
  });

  it("confirmation modal shows the configured model name", async () => {
    const el = renderButton();
    const btn = el.querySelector("[aria-label='Improve prompt using AI']") as HTMLButtonElement;

    await act(async () => {
      btn.click();
    });

    const modal = el.querySelector("[role='dialog']");
    expect(modal?.textContent).toContain("openai/gpt-4o");
  });

  it("cancels modal without calling API when Cancel is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const el = renderButton();
    const btn = el.querySelector("[aria-label='Improve prompt using AI']") as HTMLButtonElement;

    await act(async () => {
      btn.click();
    });

    const cancelBtn = el.querySelector("[role='dialog'] button:first-child") as HTMLButtonElement;
    await act(async () => {
      cancelBtn.click();
    });

    // Modal should close
    expect(el.querySelector("[role='dialog']")).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("calls useImprovePrompt.improve (POST /api/playground/improve-prompt) on confirm", async () => {
    const mockResponse = {
      improvedSystem: "You are a highly specialized assistant.",
      tokensIn: 50,
      tokensOut: 30,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockResponse), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      ) as typeof fetch
    );

    const setConfig = vi.fn();
    const el = renderButton(BASE_CONFIG, setConfig);

    const btn = el.querySelector("[aria-label='Improve prompt using AI']") as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });

    // Click confirm (Improve button)
    const modal = el.querySelector("[role='dialog']");
    const allBtns = modal?.querySelectorAll("button") ?? [];
    const improveBtn = Array.from(allBtns).find(
      (b) => b.textContent?.includes("Improve") && !b.textContent?.includes("Improve prompt")
    ) as HTMLButtonElement;
    expect(improveBtn).not.toBeNull();

    await act(async () => {
      improveBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // fetch should have been called with POST to improve-prompt
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url, opts] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("improve-prompt");
    expect(opts.method).toBe("POST");

    // setConfigState should have been called with improved system prompt
    expect(setConfig).toHaveBeenCalledTimes(1);
    const updatedConfig = setConfig.mock.calls[0][0] as typeof BASE_CONFIG;
    expect(updatedConfig.systemPrompt).toBe("You are a highly specialized assistant.");
  });
});
