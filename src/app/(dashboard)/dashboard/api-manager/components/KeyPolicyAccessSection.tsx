"use client";

/**
 * KeyPolicyAccessSection — split out of PermissionsModal.tsx for the size gate.
 */

import type {
  PermissionsModalFormParams,
  usePermissionsModalForm,
} from "./usePermissionsModalForm";
import { toLocalDateTimeInputValue } from "../apiManagerPageUtils";
import { UsageLimitSettings } from "./UsageLimitSettings";
import { ChaosModeAccessToggle } from "./ChaosModeAccessToggle";
import { BypassProviderQuotaToggle } from "./BypassProviderQuotaToggle";

type Form = ReturnType<typeof usePermissionsModalForm>;

export function KeyPolicyAccessSection({
  bypassProviderQuotaPolicyEnabled,
  chaosModeEnabled,
  dailyUsageLimitUsd,
  disableNonPublicModels,
  expiresAt,
  manageEnabled,
  mcpAdminEnabled,
  mcpReadEnabled,
  mcpWriteEnabled,
  proxiedServices,
  selfAccountQuotaEnabled,
  selfUsageEnabled,
  serviceScopesEnabled,
  setBypassProviderQuotaPolicyEnabled,
  setChaosModeEnabled,
  setDailyUsageLimitUsd,
  setDisableNonPublicModels,
  setExpiresAt,
  setManageEnabled,
  setMcpAdminEnabled,
  setMcpReadEnabled,
  setMcpWriteEnabled,
  setSelfAccountQuotaEnabled,
  setSelfUsageEnabled,
  setServiceScopesEnabled,
  setUsageCommandEnabled,
  setUsageLimitEnabled,
  setWeeklyUsageLimitUsd,
  t,
  tc,
  usageCommandEnabled,
  usageLimitEnabled,
  weeklyUsageLimitUsd,
}: Pick<
  Form,
  | "bypassProviderQuotaPolicyEnabled"
  | "chaosModeEnabled"
  | "dailyUsageLimitUsd"
  | "disableNonPublicModels"
  | "expiresAt"
  | "manageEnabled"
  | "mcpAdminEnabled"
  | "mcpReadEnabled"
  | "mcpWriteEnabled"
  | "selfAccountQuotaEnabled"
  | "selfUsageEnabled"
  | "serviceScopesEnabled"
  | "setBypassProviderQuotaPolicyEnabled"
  | "setChaosModeEnabled"
  | "setDailyUsageLimitUsd"
  | "setDisableNonPublicModels"
  | "setExpiresAt"
  | "setManageEnabled"
  | "setMcpAdminEnabled"
  | "setMcpReadEnabled"
  | "setMcpWriteEnabled"
  | "setSelfAccountQuotaEnabled"
  | "setSelfUsageEnabled"
  | "setServiceScopesEnabled"
  | "setUsageCommandEnabled"
  | "setUsageLimitEnabled"
  | "setWeeklyUsageLimitUsd"
  | "t"
  | "tc"
  | "usageCommandEnabled"
  | "usageLimitEnabled"
  | "weeklyUsageLimitUsd"
> &
  Pick<PermissionsModalFormParams, "proxiedServices">) {
  return (
    <>
      {/* Expiration Date */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text-main">{t("expirationDate")}</p>
          <p className="text-xs text-text-muted">
            Key will automatically stop working after this date.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="datetime-local"
            value={toLocalDateTimeInputValue(expiresAt)}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                setExpiresAt("");
                return;
              }
              const date = new Date(val);
              if (!Number.isNaN(date.getTime())) {
                setExpiresAt(date.toISOString());
              }
            }}
            className="min-w-0 flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-text-main"
          />
          <button
            type="button"
            onClick={() => setExpiresAt("")}
            disabled={!expiresAt}
            className="shrink-0 px-3 py-1.5 text-sm font-medium border border-border rounded-md text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            {tc("clear")}
          </button>
        </div>
      </div>
      {/* Management Access */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text-main">{t("managementAccess")}</p>
          <p className="text-xs text-text-muted">{t("managementAccessDesc")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={manageEnabled}
          onClick={() => setManageEnabled((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            manageEnabled
              ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
              : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
          {manageEnabled ? tc("enabled") : tc("disabled")}
        </button>
      </div>
      {/* MCP Gateway Access */}
      <div className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-surface/40">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text-main">{t("mcpAccess")}</p>
          <p className="text-xs text-text-muted">{t("mcpAccessDesc")}</p>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-text-main">{t("mcpAdmin")}</p>
            <p className="text-xs text-text-muted">{t("mcpAdminDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mcpAdminEnabled}
            onClick={() => setMcpAdminEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${
              mcpAdminEnabled
                ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
            {mcpAdminEnabled ? tc("enabled") : tc("disabled")}
          </button>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-text-main">{t("mcpRead")}</p>
            <p className="text-xs text-text-muted">{t("mcpReadDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mcpReadEnabled}
            onClick={() => setMcpReadEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              mcpReadEnabled
                ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">visibility</span>
            {mcpReadEnabled ? tc("enabled") : tc("disabled")}
          </button>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-text-main">{t("mcpWrite")}</p>
            <p className="text-xs text-text-muted">{t("mcpWriteDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mcpWriteEnabled}
            onClick={() => setMcpWriteEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              mcpWriteEnabled
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">edit_square</span>
            {mcpWriteEnabled ? tc("enabled") : tc("disabled")}
          </button>
        </div>
      </div>
      {proxiedServices.length > 0 && (
        <div className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("serviceAccess")}</p>
            <p className="text-xs text-text-muted">{t("serviceAccessDesc")}</p>
          </div>
          {proxiedServices.map((svc) => (
            <div key={svc.id} className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-text-main">{svc.name}</p>
                <p className="text-xs font-mono text-text-muted">svc:{svc.id}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={serviceScopesEnabled[svc.id] === true}
                onClick={() =>
                  setServiceScopesEnabled((prev) => ({
                    ...prev,
                    [svc.id]: !(prev[svc.id] === true),
                  }))
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${
                  serviceScopesEnabled[svc.id]
                    ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30"
                    : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">hub</span>
                {serviceScopesEnabled[svc.id] ? tc("enabled") : tc("disabled")}
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Self-service Visibility */}
      <div className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-surface/40">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text-main">{t("selfServiceVisibility")}</p>
          <p className="text-xs text-text-muted">{t("selfServiceVisibilityDesc")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={selfUsageEnabled}
          onClick={() =>
            setSelfUsageEnabled((prev) => {
              if (prev) setSelfAccountQuotaEnabled(false);
              return !prev;
            })
          }
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            selfUsageEnabled
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
              : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">query_stats</span>
          {t("ownUsageVisibility")} - {selfUsageEnabled ? tc("enabled") : tc("disabled")}
        </button>
        <p className="text-xs text-text-muted">{t("ownUsageVisibilityDesc")}</p>
        <button
          type="button"
          role="switch"
          aria-checked={selfAccountQuotaEnabled}
          disabled={!selfUsageEnabled}
          onClick={() => setSelfAccountQuotaEnabled((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            selfAccountQuotaEnabled
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
              : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
          } ${!selfUsageEnabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span className="material-symbols-outlined text-[14px]">account_balance</span>
          {t("sharedAccountQuotaVisibility")} -{" "}
          {selfAccountQuotaEnabled ? tc("enabled") : tc("disabled")}
        </button>
        <p className="text-xs text-text-muted">{t("sharedAccountQuotaVisibilityDesc")}</p>
        <button
          type="button"
          role="switch"
          aria-checked={usageCommandEnabled}
          onClick={() => setUsageCommandEnabled((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            usageCommandEnabled
              ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30"
              : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">terminal</span>
          {t("localUsageCommand")} - {usageCommandEnabled ? tc("enabled") : tc("disabled")}
        </button>
        <p className="text-xs text-text-muted">{t("localUsageCommandDesc")}</p>
        <UsageLimitSettings
          enabled={usageLimitEnabled}
          dailyLimitUsd={dailyUsageLimitUsd}
          weeklyLimitUsd={weeklyUsageLimitUsd}
          enabledLabel={tc("enabled")}
          disabledLabel={tc("disabled")}
          onEnabledChange={setUsageLimitEnabled}
          onDailyLimitUsdChange={setDailyUsageLimitUsd}
          onWeeklyLimitUsdChange={setWeeklyUsageLimitUsd}
        />
      </div>

      {/* Chaos Mode Access Toggle */}
      <ChaosModeAccessToggle
        enabled={chaosModeEnabled}
        onToggle={() => setChaosModeEnabled((prev) => !prev)}
      />

      {/* Advanced Provider Quota Policy Override */}
      <BypassProviderQuotaToggle
        enabled={bypassProviderQuotaPolicyEnabled}
        onToggle={() => setBypassProviderQuotaPolicyEnabled((prev) => !prev)}
      />

      {/* Disable Non-Public Models Toggle */}
      <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text-main">{t("disableNonPublicModels")}</p>
          <p className="text-xs text-text-muted">{t("disableNonPublicModelsDesc")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={disableNonPublicModels}
          onClick={() => setDisableNonPublicModels((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            disableNonPublicModels
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
              : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">
            {disableNonPublicModels ? "shield_lock" : "shield"}
          </span>
          {disableNonPublicModels ? tc("yes") : tc("no")}
        </button>
      </div>
    </>
  );
}
