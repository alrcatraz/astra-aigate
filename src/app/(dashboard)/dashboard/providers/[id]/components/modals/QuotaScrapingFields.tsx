"use client";

import { Input } from "@/shared/components";
import { providerText, type ProviderMessageTranslator } from "../../providerPageHelpers";

export type QuotaScrapingFieldValues = {
  ollamaCloudUsageCookie: string;
};

export const EMPTY_QUOTA_SCRAPING_FIELDS: QuotaScrapingFieldValues = {
  ollamaCloudUsageCookie: "",
};

export function assignQuotaScrapingProviderData(
  provider: string | undefined,
  values: QuotaScrapingFieldValues,
  target: Record<string, unknown>
) {
  if (provider === "ollama-cloud" && values.ollamaCloudUsageCookie.trim()) {
    target.ollamaCloudUsageCookie = values.ollamaCloudUsageCookie.trim();
  }
}

type QuotaScrapingFieldsProps = {
  provider?: string;
  values: QuotaScrapingFieldValues;
  onChange: (patch: Partial<QuotaScrapingFieldValues>) => void;
  t: ProviderMessageTranslator;
  editMode?: boolean;
};

export default function QuotaScrapingFields({
  provider,
  values,
  onChange,
  t,
  editMode = false,
}: QuotaScrapingFieldsProps) {
  if (provider === "ollama-cloud") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-surface/20 p-4">
        <Input
          label={providerText(t, "ollamaCloudUsageCookieLabel", "Ollama Cloud usage cookie")}
          name="ollamaCloudUsageCookie"
          type="password"
          value={values.ollamaCloudUsageCookie}
          onChange={(e) => onChange({ ollamaCloudUsageCookie: e.target.value })}
          placeholder="__Secure-session=..."
          hint={providerText(
            t,
            "ollamaCloudUsageCookieHint",
            editMode
              ? "Leave blank to keep the stored cookie. Paste the __Secure-session cookie value from ollama.com/settings to replace it."
              : "Required for quota scraping. Paste the __Secure-session cookie value from ollama.com/settings."
          )}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
        />
      </div>
    );
  }

  return null;
}
