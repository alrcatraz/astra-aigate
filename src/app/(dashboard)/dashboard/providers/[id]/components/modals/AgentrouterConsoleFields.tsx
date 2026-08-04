"use client";

import { Input } from "@/shared/components";
import { getUsageConfig } from "@/shared/constants/providers/usageConfigs";
import type { ProviderMessageTranslator } from "../../providerPageHelpers";

// #6850 — the AgentRouter quota tracker (open-sse/services/agentrouterQuotaFetcher.ts)
// reads providerSpecificData.consoleApiKey (New-API System Access Token, same generic
// field bailian-coding-plan uses for its console token) and providerSpecificData.newApiUserId
// (the New-Api-User header value) — never the routing apiKey. Persist logic lives in
// connectionProviderSpecificData.ts; this component is the only dashboard UI that lets an
// operator set both for provider "agentrouter".
//
// PLAN 2.7 — generalised to every quota-capable provider whose usage config declares
// needsSystemToken (currently the DMXAPI sites and Mistral, which reuse the same
// consoleApiKey field for their system/admin token and newApiUserId for the target
// user id header). Single source of truth: providers/usageConfigs.ts.
export type AgentrouterConsoleFieldValues = {
  consoleApiKey: string;
  newApiUserId: string;
};

type AgentrouterConsoleFieldsProps = {
  provider?: string;
  values: AgentrouterConsoleFieldValues;
  onChange: (patch: Partial<AgentrouterConsoleFieldValues>) => void;
  t: ProviderMessageTranslator;
};

export default function AgentrouterConsoleFields({
  provider,
  values,
  onChange,
  t,
}: AgentrouterConsoleFieldsProps) {
  const needsSystemToken =
    provider === "agentrouter" || getUsageConfig(provider)?.needsSystemToken === true;
  if (!needsSystemToken) return null;
  const isDmxapi = provider?.startsWith("dmxapi");
  return (
    <>
      <Input
        label={t("systemAdminTokenLabel")}
        value={values.consoleApiKey}
        onChange={(e) => onChange({ consoleApiKey: e.target.value })}
        placeholder={t("systemAdminTokenPlaceholder")}
        hint={t("systemAdminTokenHint")}
        type="password"
      />
      {(provider === "agentrouter" || isDmxapi) && (
        <Input
          label={isDmxapi ? t("dmxapiUserIdLabel") : t("newApiUserIdLabel")}
          value={values.newApiUserId}
          onChange={(e) => onChange({ newApiUserId: e.target.value })}
          placeholder={isDmxapi ? t("dmxapiUserIdPlaceholder") : t("newApiUserIdPlaceholder")}
          hint={isDmxapi ? t("dmxapiUserIdHint") : t("newApiUserIdHint")}
        />
      )}
    </>
  );
}
