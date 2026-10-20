// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

type Translator = ((key: string, values?: Record<string, unknown>) => string) & {
  has: (key: string) => boolean;
  rich: (key: string, values?: Record<string, unknown>) => string;
  markup: (key: string, values?: Record<string, unknown>) => string;
  raw: (key: string) => string;
};

// Local next-intl double: same contract as tests/_setup/nextIntlDouble (stable
// translator per namespace, real English copy from en.json) but it also splits
// a DOTTED namespace ("playground.build") into path segments. The shared double
// looks the namespace up as one literal key, so BuildWizard — the only consumer
// of a nested namespace — rendered raw keys ("step1Label", "nextButton").
vi.mock("next-intl", async () => {
  const messages = (await import("../../../src/i18n/messages/en.json")).default as Record<
    string,
    unknown
  >;

  function resolve(namespace: string, key: string): string | undefined {
    let node: unknown = messages;
    for (const part of [...namespace.split("."), ...key.split(".")].filter(Boolean)) {
      if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return typeof node === "string" ? node : undefined;
  }

  const translators = new Map<string, Translator>();

  function translatorFor(namespace: string): Translator {
    const cached = translators.get(namespace);
    if (cached) return cached;
    const t = ((key: string, values?: Record<string, unknown>) => {
      const message = resolve(namespace, key) ?? key;
      if (!values) return message;
      return message.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in values ? String(values[name]) : match
      );
    }) as Translator;
    t.has = (key: string) => resolve(namespace, key) !== undefined;
    t.rich = (key: string, values?: Record<string, unknown>) => t(key, values);
    t.markup = (key: string, values?: Record<string, unknown>) => t(key, values);
    t.raw = (key: string) => resolve(namespace, key) ?? key;
    translators.set(namespace, t);
    return t;
  }

  return { useTranslations: (namespace = "") => translatorFor(namespace), useLocale: () => "en" };
});

vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

// Synchronous on purpose: a thenable handed to a sync `act()` opens an async act
// scope that is never awaited, after which later act() calls queue without
// flushing (empty DOM, null selectors).
function setInputValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const nativeSetter =
    el instanceof HTMLTextAreaElement
      ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
      : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  nativeSetter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const { DEFAULT_PARAMS } =
  await import("../../../src/app/(dashboard)/dashboard/playground/components/ParamSliders");
const { default: BuildTab } =
  await import("../../../src/app/(dashboard)/dashboard/playground/components/tabs/BuildTab");

const BASE_CONFIG = {
  endpoint: "chat.completions" as const,
  baseUrl: "http://localhost:20128",
  model: "openai/gpt-4o",
  systemPrompt: "You are helpful.",
  params: { ...DEFAULT_PARAMS },
};

if (typeof Element.prototype.scrollIntoView === "undefined") {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: () => {},
    writable: true,
    configurable: true,
  });
}

const containers: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = [];

function renderBuildTab(config = BASE_CONFIG): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<BuildTab configState={config} />);
  });
  containers.push({ root, el });
  return el;
}

// ── BuildWizard navigation helpers ──────────────────────────────────────────
//
// BuildTab now renders behind a 3-step wizard (BuildWizard.tsx):
//   step 1 — pick a mode (Tools / JSON / Both)
//   step 2 — configure tools and/or the JSON schema, depending on the mode
//   step 3 — run + toolbar badges + prompt textarea
//
// Labels are asserted as the real English copy resolved from en.json ("Next",
// "Run", "Tools + JSON", ...).

type BuildMode = "tools" | "json" | "both";

function clickNext(el: HTMLDivElement): void {
  // The button renders "Next" plus a material-symbols icon glyph, so match on
  // substring rather than the trimmed label.
  const nextBtn = Array.from(el.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Next")
  ) as HTMLButtonElement;
  act(() => {
    nextBtn.click();
  });
}

function selectMode(el: HTMLDivElement, mode: BuildMode): void {
  // Step 1's default mode is already "tools" — only click a mode card when a
  // different mode is required.
  if (mode === "tools") return;
  const title = mode === "json" ? "JSON" : "Tools + JSON";
  // Mode cards render their title in its own <span>; match that exactly so
  // "JSON" does not also pick the "Tools + JSON" card.
  const card = Array.from(el.querySelectorAll("button")).find((b) =>
    Array.from(b.querySelectorAll("span")).some((sp) => sp.textContent?.trim() === title)
  ) as HTMLButtonElement;
  act(() => {
    card.click();
  });
}

/** Drive the wizard from step 1 to step 2, selecting `mode` along the way. */
function goToStep2(el: HTMLDivElement, mode: BuildMode = "tools"): void {
  selectMode(el, mode);
  clickNext(el);
}

/** Drive the wizard from step 1 all the way to step 3 (run screen). */
function goToStep3(el: HTMLDivElement, mode: BuildMode = "tools"): void {
  goToStep2(el, mode);
  clickNext(el);
}

afterEach(() => {
  for (const { root, el } of containers) {
    act(() => root.unmount());
    el.remove();
  }
  containers.length = 0;
  vi.restoreAllMocks();
});

describe("BuildTab", () => {
  it("renders Run button", () => {
    const el = renderBuildTab();
    goToStep3(el);
    const runBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Run")
    );
    expect(runBtn).not.toBeUndefined();
  });

  it("renders Function calling section", () => {
    const el = renderBuildTab();
    goToStep2(el, "tools");
    expect(el.textContent).toContain("Tools");
    expect(el.textContent).toContain("Add tool");
  });

  it("renders Structured output section", () => {
    const el = renderBuildTab();
    goToStep2(el, "json");
    expect(el.textContent).toContain("Structured Output");
    expect(el.textContent).toContain("JSON mode");
  });

  it("adds a tool and shows it in function calling UI", async () => {
    const el = renderBuildTab();
    goToStep2(el, "tools");

    // Find add tool form inputs in the tools panel
    const allInputs = el.querySelectorAll("input[type='text']") as NodeListOf<HTMLInputElement>;
    // The first input is the function name
    const nameInput = allInputs[0];
    act(() => setInputValue(nameInput, "search_web"));

    const addBtns = el.querySelectorAll("button");
    const addToolBtn = Array.from(addBtns).find(
      (b) => b.textContent?.trim() === "+ Add tool"
    ) as HTMLButtonElement;
    expect(addToolBtn).not.toBeNull();

    await act(async () => {
      addToolBtn.click();
    });

    expect(el.textContent).toContain("search_web");
    expect(el.textContent).toContain("Tools (1)");
  });

  it("shows validation error for invalid JSON in tool params", async () => {
    const el = renderBuildTab();
    goToStep2(el, "tools");

    const allInputs = el.querySelectorAll("input[type='text']") as NodeListOf<HTMLInputElement>;
    act(() => setInputValue(allInputs[0], "bad_tool"));

    // The parameters textarea is in the Add tool form section — it has default valid JSON.
    const paramsTextareas = Array.from(el.querySelectorAll("textarea")).filter(
      (t) => t.getAttribute("aria-label") === "JSON schema for parameters"
    );
    const paramsTextarea = paramsTextareas[paramsTextareas.length - 1] as HTMLTextAreaElement;
    act(() => setInputValue(paramsTextarea, "NOT JSON {{{"));

    const addBtns = el.querySelectorAll("button");
    const addToolBtn = Array.from(addBtns).find(
      (b) => b.textContent?.trim() === "+ Add tool"
    ) as HTMLButtonElement;

    await act(async () => {
      addToolBtn.click();
    });

    expect(el.textContent).toContain("valid JSON");
  });

  it("enables JSON mode toggle and shows schema editor", async () => {
    const el = renderBuildTab();
    goToStep2(el, "json");

    const toggle = el.querySelector("[role='switch']") as HTMLButtonElement;
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle.click();
    });

    // JSON mode should be enabled
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(el.textContent).toContain("JSON schema");
  });

  it("shows tool badge in toolbar when tools are added", async () => {
    const el = renderBuildTab();
    goToStep2(el, "tools");

    const allInputs = el.querySelectorAll("input[type='text']") as NodeListOf<HTMLInputElement>;
    act(() => setInputValue(allInputs[0], "my_tool"));

    const addBtns = el.querySelectorAll("button");
    const addToolBtn = Array.from(addBtns).find(
      (b) => b.textContent?.trim() === "+ Add tool"
    ) as HTMLButtonElement;
    await act(async () => {
      addToolBtn.click();
    });

    clickNext(el); // step 2 -> step 3

    // Badge "1 tool" should appear in the step-3 toolbar
    expect(el.textContent).toContain("1 tool");
  });

  it("calls /v1/chat/completions with tools array when Run is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Result", role: "assistant" } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      ) as typeof fetch
    );

    const el = renderBuildTab();
    goToStep2(el, "tools");

    // Add a tool
    const allInputs = el.querySelectorAll("input[type='text']") as NodeListOf<HTMLInputElement>;
    act(() => setInputValue(allInputs[0], "tool_one"));
    const addBtns = el.querySelectorAll("button");
    const addToolBtn = Array.from(addBtns).find(
      (b) => b.textContent?.trim() === "+ Add tool"
    ) as HTMLButtonElement;
    await act(async () => {
      addToolBtn.click();
    });

    clickNext(el); // step 2 -> step 3

    // Type a prompt (the only textarea left on step 3 is the prompt input)
    const promptTextarea = el.querySelector("textarea") as HTMLTextAreaElement;
    act(() => setInputValue(promptTextarea, "Run this tool"));

    // Click Run
    const runBtns = el.querySelectorAll("button");
    const runBtn = Array.from(runBtns).find((b) =>
      b.textContent?.includes("Run")
    ) as HTMLButtonElement;
    await act(async () => {
      runBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // fetch should be called
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [, opts] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body["tools"]).toBeDefined();
    expect(Array.isArray(body["tools"])).toBe(true);
  });

  it("shows JSON mode badge in toolbar when JSON mode is enabled", async () => {
    const el = renderBuildTab();
    goToStep2(el, "json");
    const toggle = el.querySelector("[role='switch']") as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });

    clickNext(el); // step 2 -> step 3

    expect(el.textContent).toContain("JSON mode");
  });
});
