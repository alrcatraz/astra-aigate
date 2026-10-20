// @vitest-environment jsdom
/**
 * ProviderPageHeader — discreet "Partner link" indicator on the top-of-page
 * website link for the 3 visible Kimi (Moonshot AI) provider cards
 * (kimi-coding, kimi-web, moonshot). Presentation only — see
 * featuredProviders.ts (isKimiPartnerProviderId) and the aff-link URLs
 * asserted in tests/unit/kimi-partner-aff-links.test.ts.
 */
import "../../_setup/nextIntlDouble";
import { resolveMessage } from "../../_setup/nextIntlDouble";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import ProviderPageHeader from "@/app/(dashboard)/dashboard/providers/[id]/components/ProviderPageHeader";

// No `.has` method — providerText() falls back to the hardcoded English
// default, matching the pattern used in providerCardKimiPartnerAccent.test.tsx.
const t = (key: string) => key;

// The note is brand copy: compare against the real en.json message so the
// component's fallback literal can never silently drift from the catalogue.
const PARTNER_LINK_NOTE = resolveMessage("providers", "kimiPartnerLinkNote")!;

describe("ProviderPageHeader — Kimi partner-link note", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (container) {
      document.body.removeChild(container);
      container = null;
    }
  });

  function renderHeader(id: string, name: string, website: string) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <ProviderPageHeader
          providerId={id}
          providerInfo={{ id, name, website, color: "#1783FF" }}
          connectionsCount={0}
          isOpenAICompatible={false}
          isAnthropicProtocolCompatible={false}
          onOpenTutorial={() => {}}
          t={t}
        />
      );
    });
    return container;
  }

  it.each([
    ["moonshot", "Kimi", "https://platform.kimi.ai?aff=omniroute"],
    ["kimi-coding", "Kimi Code CLI", "https://www.kimi.com/code?aff=omniroute"],
    ["kimi-web", "Kimi Web", "https://www.kimi.com/code?aff=omniroute"],
  ])("flags the %s header link as a partner link", (id, name, website) => {
    const el = renderHeader(id, name, website);
    // The component also renders a "Back to Providers" <Link> above the
    // website title link — target the website anchor specifically, not the
    // first <a> in the tree.
    const link = el.querySelector(`a[href="${website}"]`);
    expect(link).not.toBeNull();
    expect(link?.getAttribute("title")).toBe(PARTNER_LINK_NOTE);
    expect(link?.getAttribute("aria-label")).toBe(`${name} — ${PARTNER_LINK_NOTE}`);
    expect(el.textContent).toContain(PARTNER_LINK_NOTE);
  });

  it("does NOT flag an unrelated provider's website link as a partner link", () => {
    const el = renderHeader("openai", "OpenAI", "https://openai.com");
    const link = el.querySelector(`a[href="https://openai.com"]`);
    expect(link).not.toBeNull();
    expect(link?.getAttribute("title")).toBeNull();
    expect(link?.getAttribute("aria-label")).toBeNull();
    expect(el.textContent).not.toContain("Partner link");
  });
});
