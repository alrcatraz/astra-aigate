"use client";

/**
 * API-key permissions modal, extracted from ApiManagerPageClient.tsx.
 */

import { useState, useEffect, useMemo, useCallback, memo, useRef, useId } from "react";
import { Card, Button, Input, Modal, CardSkeleton } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useLocale, useTranslations } from "next-intl";
import { getProviderDisplayName } from "@/lib/display/names";
import { compareTr, matchesSearch } from "@/shared/utils/turkishText";
import { ENDPOINT_CATEGORIES } from "@/shared/constants/endpointCategories";
import ApiKeyFilterBar from "./ApiKeyFilterBar";
import {
  isKeyActive,
  isExpired,
  isRestricted as isKeyRestricted,
  classifyKeyStatus,
  computeApiKeyCounts,
  formatUsdCost,
  toLocalDateTimeInputValue,
  toggleKeyVisibility,
} from "../apiManagerPageUtils";
import type { KeyStatus, KeyType } from "../apiManagerPageUtils";
import { readActiveOnlyPreference, writeActiveOnlyPreference } from "../apiManagerPageStorage";
import { buildApiKeyCreateScopes, mergeApiKeyPermissionScopes } from "../apiManagerScopes";
import { SELF_ACCOUNT_QUOTA_SCOPE, SELF_USAGE_SCOPE } from "@/shared/constants/selfServiceScopes";
import { MCP_ADMIN_SCOPE, MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/shared/constants/mcpScopes";
import { extractApiErrorMessage } from "@/shared/http/apiErrorMessage";
import { hasProviderQuotaBypassScope } from "@/shared/constants/apiKeyPolicyScopes";
import { UsageLimitSettings } from "./UsageLimitSettings";
import { ChaosModeAccessToggle } from "./ChaosModeAccessToggle";
import { BypassProviderQuotaToggle } from "./BypassProviderQuotaToggle";
import ReasoningRoutingRules from "@/shared/components/ReasoningRoutingRules";
import {
  usePermissionsModalForm,
  type PermissionsModalFormParams,
} from "./usePermissionsModalForm";
import { KeyPolicyAccessSection } from "./KeyPolicyAccessSection";
import { AllowedResourcesSection } from "./AllowedResourcesSection";
import {
  MAX_KEY_NAME_LENGTH,
  MAX_SELECTED_MODELS,
  CLAUDE_CODE_DEFAULT_MODEL_ID,
  CLAUDE_CODE_DEFAULT_MODEL_NAME,
  CLAUDE_CODE_DEFAULT_FAMILIES,
  ClaudeCodeFamilyId,
  ClaudeCodeBlockableFamilyId,
  CLAUDE_CODE_FAMILY_BLOCK_PATTERNS,
  CLAUDE_CODE_BLOCK_PATTERN_SET,
  useDebouncedValue,
  sanitizeInput,
  validateKeyName,
  AccessSchedule,
  StreamDefaultMode,
  ApiKey,
  ProviderConnection,
  KeyUsageStats,
  Model,
  ComboOption,
  ProviderGroup,
  isClaudeCodeModel,
  withClaudeCodeDefaultModel,
  getBlockedClaudeCodeFamilies,
  isClaudeCodeFamilyModel,
} from "../apiManagerShared";

export const PermissionsModal = memo(function PermissionsModal({
  isOpen,
  onClose,
  apiKey,
  modelsByProvider,
  allModels,
  modelsLoaded,
  allCombos,
  allConnections,
  searchModel,
  onSearchChange,
  onSave,
  proxiedServices,
}: PermissionsModalFormParams) {
  const {
    t,
    tc,
    initialModels,
    initialBlockedModels,
    initialCombos,
    initialConnections,
    keyName,
    setKeyName,
    selectedModels,
    setSelectedModels,
    blockedClaudeCodeFamilies,
    setBlockedClaudeCodeFamilies,
    claudeCodeFamiliesExpanded,
    setClaudeCodeFamiliesExpanded,
    selectedCombos,
    setSelectedCombos,
    allowAll,
    setAllowAll,
    allowAllCombos,
    setAllowAllCombos,
    noLogEnabled,
    setNoLogEnabled,
    autoResolveEnabled,
    setAutoResolveEnabled,
    keyIsActive,
    setKeyIsActive,
    throttleDelayMs,
    setThrottleDelayMs,
    keyIsBanned,
    setKeyIsBanned,
    expiresAt,
    setExpiresAt,
    manageEnabled,
    setManageEnabled,
    mcpAdminEnabled,
    setMcpAdminEnabled,
    mcpReadEnabled,
    setMcpReadEnabled,
    mcpWriteEnabled,
    setMcpWriteEnabled,
    serviceScopesEnabled,
    setServiceScopesEnabled,
    selfUsageEnabled,
    setSelfUsageEnabled,
    selfAccountQuotaEnabled,
    setSelfAccountQuotaEnabled,
    bypassProviderQuotaPolicyEnabled,
    setBypassProviderQuotaPolicyEnabled,
    maxSessions,
    setMaxSessions,
    scheduleEnabled,
    setScheduleEnabled,
    scheduleFrom,
    setScheduleFrom,
    scheduleUntil,
    setScheduleUntil,
    scheduleDays,
    setScheduleDays,
    scheduleTz,
    setScheduleTz,
    rateLimits,
    setRateLimits,
    streamDefaultMode,
    setStreamDefaultMode,
    nameError,
    setNameError,
    saveError,
    setSaveError,
    selectedConnections,
    setSelectedConnections,
    allowAllConnections,
    setAllowAllConnections,
    expandedProviders,
    setExpandedProviders,
    initialEndpoints,
    selectedEndpoints,
    setSelectedEndpoints,
    allowAllEndpoints,
    setAllowAllEndpoints,
    disableNonPublicModels,
    setDisableNonPublicModels,
    usageCommandEnabled,
    setUsageCommandEnabled,
    chaosModeEnabled,
    setChaosModeEnabled,
    usageLimitEnabled,
    setUsageLimitEnabled,
    dailyUsageLimitUsd,
    setDailyUsageLimitUsd,
    weeklyUsageLimitUsd,
    setWeeklyUsageLimitUsd,
    getModelDisplayName,
    handleToggleModel,
    handleToggleProvider,
    handleSelectAll,
    handleRestrictMode,
    handleToggleExpand,
    handleSelectAllModels,
    handleDeselectAllModels,
    handleBlockClaudeCodeFamily,
    handleToggleCombo,
    handleToggleConnection,
    handleToggleEndpoint,
    parseUsdLimitInput,
    handleSave,
    selectedCount,
    totalModels,
    hasClaudeCodeDefaultSelected,
    orderedSelectedModels,
    visibleClaudeCodeFamilies,
  } = usePermissionsModalForm({
    isOpen,
    onClose,
    apiKey,
    modelsByProvider,
    allModels,
    modelsLoaded,
    allCombos,
    allConnections,
    searchModel,
    onSearchChange,
    onSave,
    proxiedServices,
  });

  return (
    <Modal
      isOpen={onClose ? isOpen : false}
      title={t("permissionsTitle", { name: apiKey?.name || "" })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {/* Key Name */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("keyName")}</p>
            <p className="text-xs text-text-muted">{t("keyNameDesc")}</p>
          </div>
          <div className="w-48 shrink-0">
            <Input
              value={keyName}
              onChange={(e) => {
                setKeyName(e.target.value);
                setNameError(null);
              }}
              placeholder={t("keyNamePlaceholder")}
              maxLength={MAX_KEY_NAME_LENGTH}
              error={nameError}
            />
          </div>
        </div>

        {/* Inline save error */}
        {saveError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
            <span className="material-symbols-outlined text-red-500 text-sm">error</span>
            <p className="text-sm text-red-700 dark:text-red-300 flex-1">{saveError}</p>
          </div>
        )}

        {apiKey?.id && <ReasoningRoutingRules apiKeyId={apiKey.id} />}

        {/* Access Mode Toggle */}
        <div className="flex gap-2 p-1 bg-surface rounded-lg">
          <button
            onClick={handleSelectAll}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
              allowAll
                ? "bg-primary text-white"
                : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">lock_open</span>
            {t("allowAll")}
          </button>
          <button
            onClick={handleRestrictMode}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
              !allowAll
                ? "bg-primary text-white"
                : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">lock</span>
            {t("restrict")}
          </button>
        </div>

        {/* Info Banner */}
        <div
          className={`flex items-start gap-2 p-3 rounded-lg ${
            allowAll
              ? "bg-green-500/10 border border-green-500/30"
              : "bg-amber-500/10 border border-amber-500/30"
          }`}
        >
          <span
            className={`material-symbols-outlined text-[18px] ${
              allowAll ? "text-green-500" : "text-amber-500"
            }`}
          >
            {allowAll ? "info" : "warning"}
          </span>
          <p
            className={`text-xs ${
              allowAll ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"
            }`}
          >
            {allowAll
              ? t("allowAllDesc")
              : !modelsLoaded
                ? t("restrictLoading")
                : totalModels === 0
                  ? t("restrictCatalogUnavailable", { selectedCount })
                  : t("restrictDesc", { selectedCount, totalModels })}
          </p>
        </div>

        {/* Key Active Toggle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("keyActive")}</p>
            <p className="text-xs text-text-muted">{t("keyActiveDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={keyIsActive}
            onClick={() => setKeyIsActive((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              keyIsActive
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                : "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {keyIsActive ? "check_circle" : "block"}
            </span>
            {keyIsActive ? tc("enabled") : tc("disabled")}
          </button>
        </div>

        {/* Max Sessions Limit (T08) */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("maxActiveSessions")}</p>
            <p className="text-xs text-text-muted">{t("maxActiveSessionsDescription")}</p>
          </div>
          <div className="w-32">
            <Input
              type="number"
              min={0}
              step={1}
              value={String(maxSessions)}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value || "0", 10);
                setMaxSessions(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
              }}
            />
          </div>
        </div>

        {/* Soft Throttle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("throttleDelay")}</p>
            <p className="text-xs text-text-muted">{t("throttleDelayDescription")}</p>
          </div>
          <div className="w-36">
            <Input
              type="number"
              min={0}
              max={300000}
              step={100}
              value={String(throttleDelayMs)}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value || "0", 10);
                setThrottleDelayMs(
                  Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 300000) : 0
                );
              }}
            />
            <p className="text-[10px] text-text-muted mt-1">milliseconds</p>
          </div>
        </div>

        {/* Custom Rate Limits */}
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text-main">
                {t("apiManagerCustomRateLimits")}
              </p>
              <p className="text-xs text-text-muted">{t("apiManagerCustomRateLimitsDesc")}</p>
            </div>
            <button
              type="button"
              onClick={() => setRateLimits((prev) => [...prev, { limit: 100, window: 60 }])}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Add Limit
            </button>
          </div>
          {rateLimits.length > 0 && (
            <div className="flex flex-col gap-2 pt-2">
              {rateLimits.map((rl, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min={1}
                    value={String(rl.limit)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRateLimits((prev) => {
                        const next = [...prev];
                        next[index].limit = val;
                        return next;
                      });
                    }}
                    placeholder={t("apiManagerRateLimitRequestsPlaceholder")}
                  />
                  <span className="text-sm text-text-muted shrink-0">
                    {t("apiManagerRateLimitReqPer")}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    value={String(rl.window)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRateLimits((prev) => {
                        const next = [...prev];
                        next[index].window = val;
                        return next;
                      });
                    }}
                    placeholder={t("apiManagerRateLimitSecondsPlaceholder")}
                  />
                  <span className="text-sm text-text-muted shrink-0">sec</span>
                  <button
                    type="button"
                    onClick={() => setRateLimits((prev) => prev.filter((_, i) => i !== index))}
                    className="p-2 text-red-500 hover:bg-red-500/10 rounded transition-colors shrink-0"
                    title={t("apiManagerRemoveLimitTitle")}
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Access Schedule */}
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text-main">{t("accessSchedule")}</p>
              <p className="text-xs text-text-muted">{t("accessScheduleDesc")}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={scheduleEnabled}
              onClick={() => setScheduleEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${
                scheduleEnabled
                  ? "bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30"
                  : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              {scheduleEnabled ? tc("enabled") : tc("disabled")}
            </button>
          </div>
          {scheduleEnabled && (
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t("scheduleFrom")}</label>
                  <input
                    type="time"
                    value={scheduleFrom}
                    onChange={(e) => setScheduleFrom(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-text-main"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t("scheduleUntil")}</label>
                  <input
                    type="time"
                    value={scheduleUntil}
                    onChange={(e) => setScheduleUntil(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-text-main"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1.5 block">{t("scheduleDays")}</label>
                <div className="flex gap-1 flex-wrap">
                  {(
                    [
                      [0, t("daySun")],
                      [1, t("dayMon")],
                      [2, t("dayTue")],
                      [3, t("dayWed")],
                      [4, t("dayThu")],
                      [5, t("dayFri")],
                      [6, t("daySat")],
                    ] as [number, string][]
                  ).map(([dayIdx, label]) => {
                    const selected = scheduleDays.includes(dayIdx);
                    return (
                      <button
                        key={dayIdx}
                        type="button"
                        onClick={() =>
                          setScheduleDays((prev) =>
                            prev.includes(dayIdx)
                              ? prev.filter((d) => d !== dayIdx)
                              : [...prev, dayIdx].sort((a, b) => a - b)
                          )
                        }
                        className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${
                          selected
                            ? "bg-primary text-white"
                            : "bg-surface border border-border text-text-muted hover:border-primary/50"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">
                  {t("scheduleTimezone")}
                </label>
                <input
                  type="text"
                  value={scheduleTz}
                  onChange={(e) => setScheduleTz(e.target.value)}
                  placeholder={t("apiManagerTimezonePlaceholder")}
                  className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-text-main font-mono"
                />
                <p className="text-[10px] text-text-muted mt-1">{t("scheduleTimezoneHint")}</p>
              </div>
            </div>
          )}
        </div>

        {/* Privacy Toggle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("noLogPayloadPrivacy")}</p>
            <p className="text-xs text-text-muted">
              Disable request/response payload persistence for this API key.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={noLogEnabled}
            onClick={() => setNoLogEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              noLogEnabled
                ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {noLogEnabled ? "visibility_off" : "visibility"}
            </span>
            {noLogEnabled ? tc("enabled") : tc("disabled")}
          </button>
        </div>

        {/* Auto-Resolve Toggle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("autoResolve")}</p>
            <p className="text-xs text-text-muted">{t("autoResolveDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoResolveEnabled}
            onClick={() => setAutoResolveEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              autoResolveEnabled
                ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {autoResolveEnabled ? "auto_fix_high" : "auto_fix_normal"}
            </span>
            {autoResolveEnabled ? tc("enabled") : tc("disabled")}
          </button>
        </div>

        {/* Stream Default Compatibility */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-sm font-medium text-text-main">{t("streamDefaultMode")}</p>
            <p className="text-xs text-text-muted">{t("streamDefaultModeDesc")}</p>
          </div>
          <div className="flex gap-1 p-0.5 bg-surface rounded-md shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setStreamDefaultMode("legacy")}
              className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                streamDefaultMode === "legacy"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">settings_backup_restore</span>
              {t("streamDefaultLegacy")}
            </button>
            <button
              type="button"
              onClick={() => setStreamDefaultMode("json")}
              className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                streamDefaultMode === "json"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">data_object</span>
              {t("streamDefaultJson")}
            </button>
          </div>
        </div>

        {/* Ban Toggle (SECURITY) */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{t("bannedStatus")}</p>
            <p className="text-xs text-red-600 dark:text-red-300">
              Immediately revoke all access. Used for suspected abuse or compromised keys.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={keyIsBanned}
            onClick={() => setKeyIsBanned((prev) => !prev)}
            className={`inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors ${
              keyIsBanned
                ? "bg-red-500 text-white shadow-sm"
                : "bg-black/5 dark:bg-white/5 text-text-muted hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {keyIsBanned ? "block" : "check_circle"}
            </span>
            {keyIsBanned ? "Banned" : "Active"}
          </button>
        </div>
        <KeyPolicyAccessSection
          bypassProviderQuotaPolicyEnabled={bypassProviderQuotaPolicyEnabled}
          chaosModeEnabled={chaosModeEnabled}
          dailyUsageLimitUsd={dailyUsageLimitUsd}
          disableNonPublicModels={disableNonPublicModels}
          expiresAt={expiresAt}
          manageEnabled={manageEnabled}
          mcpAdminEnabled={mcpAdminEnabled}
          mcpReadEnabled={mcpReadEnabled}
          mcpWriteEnabled={mcpWriteEnabled}
          proxiedServices={proxiedServices}
          selfAccountQuotaEnabled={selfAccountQuotaEnabled}
          selfUsageEnabled={selfUsageEnabled}
          serviceScopesEnabled={serviceScopesEnabled}
          setBypassProviderQuotaPolicyEnabled={setBypassProviderQuotaPolicyEnabled}
          setChaosModeEnabled={setChaosModeEnabled}
          setDailyUsageLimitUsd={setDailyUsageLimitUsd}
          setDisableNonPublicModels={setDisableNonPublicModels}
          setExpiresAt={setExpiresAt}
          setManageEnabled={setManageEnabled}
          setMcpAdminEnabled={setMcpAdminEnabled}
          setMcpReadEnabled={setMcpReadEnabled}
          setMcpWriteEnabled={setMcpWriteEnabled}
          setSelfAccountQuotaEnabled={setSelfAccountQuotaEnabled}
          setSelfUsageEnabled={setSelfUsageEnabled}
          setServiceScopesEnabled={setServiceScopesEnabled}
          setUsageCommandEnabled={setUsageCommandEnabled}
          setUsageLimitEnabled={setUsageLimitEnabled}
          setWeeklyUsageLimitUsd={setWeeklyUsageLimitUsd}
          t={t}
          tc={tc}
          usageCommandEnabled={usageCommandEnabled}
          usageLimitEnabled={usageLimitEnabled}
          weeklyUsageLimitUsd={weeklyUsageLimitUsd}
        />
        {/* Selected Models Summary (only in restrict mode) */}
        {!allowAll && selectedCount > 0 && (
          <div className="flex flex-col gap-1.5 p-2 bg-primary/5 rounded-lg border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary">
                {t("selectedCount", { count: selectedCount })}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={handleSelectAllModels}
                  className="text-[10px] text-primary hover:bg-primary/10 px-1.5 py-0.5 rounded transition-colors"
                >
                  {tc("all")}
                </button>
                <button
                  onClick={handleDeselectAllModels}
                  className="text-[10px] text-red-500 hover:bg-red-500/10 px-1.5 py-0.5 rounded transition-colors"
                >
                  {t("clear")}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto content-start">
              {orderedSelectedModels.map((modelId) => {
                if (modelId === CLAUDE_CODE_DEFAULT_MODEL_ID) {
                  return (
                    <div key={modelId} className="flex flex-col gap-1 basis-full">
                      <span className="inline-flex w-fit items-center gap-0.5 px-1.5 py-0.5 bg-primary/10 text-text-main text-[10px] rounded border border-primary/35">
                        <button
                          type="button"
                          onClick={() => setClaudeCodeFamiliesExpanded((prev) => !prev)}
                          className="inline-flex items-center gap-1 font-mono text-text-main"
                          title={t("expandClaudeCodeFamilies")}
                          aria-expanded={claudeCodeFamiliesExpanded}
                        >
                          <span className="truncate max-w-[140px]" title={modelId}>
                            {getModelDisplayName(modelId)}
                          </span>
                          <span className="material-symbols-outlined text-[12px] text-primary">
                            {claudeCodeFamiliesExpanded ? "expand_less" : "expand_more"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleModel(modelId)}
                          className="text-text-muted hover:text-red-500 transition-colors"
                          title={t("removeClaudeCodeDefault")}
                        >
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      </span>

                      {claudeCodeFamiliesExpanded && (
                        <div className="relative ml-2 flex flex-wrap gap-1 pl-5 animate-in fade-in slide-in-from-top-1 duration-150">
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-1.5 top-0 bottom-1 w-px bg-primary/25"
                          />
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-1.5 top-3 h-px w-3 bg-primary/25"
                          />
                          {visibleClaudeCodeFamilies.map((family) => {
                            const canBlock = family.id !== "other";
                            return (
                              <span
                                key={family.id}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border ${
                                  canBlock
                                    ? "bg-white dark:bg-surface text-text-main border-border"
                                    : "bg-black/5 dark:bg-white/5 text-text-muted border-border"
                                }`}
                                title={
                                  canBlock
                                    ? `Allow ${family.label} family through Claude Code default`
                                    : "Catch-all for other Claude Code models"
                                }
                              >
                                <span className="font-mono">{family.label}</span>
                                {canBlock && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleBlockClaudeCodeFamily(
                                        family.id as ClaudeCodeBlockableFamilyId
                                      )
                                    }
                                    className="text-text-muted hover:text-red-500 transition-colors"
                                    title={`Block ${family.label} family`}
                                  >
                                    <span className="material-symbols-outlined text-[12px]">
                                      close
                                    </span>
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <span
                    key={modelId}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white dark:bg-surface text-text-main text-[10px] rounded border border-border"
                  >
                    <span className="font-mono truncate max-w-[120px]" title={modelId}>
                      {getModelDisplayName(modelId)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleModel(modelId)}
                      className="text-text-muted hover:text-red-500 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Search and Model Selection (only in restrict mode) */}
        {!allowAll && (
          <>
            <div className="relative">
              <Input
                value={searchModel}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("searchModels")}
                icon="search"
              />
              {searchModel && (
                <button
                  onClick={() => onSearchChange("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              )}
            </div>

            <div className="max-h-[280px] overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {modelsByProvider.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-text-muted">
                  <span className="material-symbols-outlined text-2xl mb-1">search_off</span>
                  <p className="text-xs">{t("noModelsFound")}</p>
                </div>
              ) : (
                modelsByProvider.map(([provider, models]) => {
                  const selectedInProvider = selectedModels.filter((m) =>
                    models.some((model) => model.id === m)
                  ).length;
                  const allSelected = models.every((m) => selectedModels.includes(m.id));
                  const someSelected = selectedInProvider > 0 && !allSelected;

                  return (
                    <div key={provider} className="group">
                      <button
                        onClick={() => handleToggleExpand(provider)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface/50 transition-colors text-left"
                      >
                        <span
                          className={`material-symbols-outlined text-base transition-transform duration-200 ${
                            expandedProviders.has(provider) ? "rotate-90" : ""
                          }`}
                        >
                          chevron_right
                        </span>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div
                            className="relative flex items-center cursor-pointer shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleProvider(provider, models);
                            }}
                          >
                            <div
                              className={`w-4 h-4 rounded border-2 transition-colors flex items-center justify-center ${
                                allSelected
                                  ? "bg-primary border-primary"
                                  : someSelected
                                    ? "bg-primary/20 border-primary"
                                    : "border-border hover:border-primary/50"
                              }`}
                            >
                              {allSelected && (
                                <span className="material-symbols-outlined text-white text-[12px]">
                                  check
                                </span>
                              )}
                              {someSelected && !allSelected && (
                                <span className="material-symbols-outlined text-primary text-[12px]">
                                  remove
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-text-main truncate">
                            {provider}
                          </span>
                          <span className="text-[10px] text-text-muted bg-surface px-1 py-0.5 rounded shrink-0">
                            {models.length}
                          </span>
                        </div>
                        {selectedInProvider > 0 && (
                          <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">
                            {selectedInProvider}
                          </span>
                        )}
                      </button>

                      {/* Expandable model list */}
                      {expandedProviders.has(provider) && (
                        <div className="px-3 pb-2 pl-9">
                          <div className="flex flex-wrap gap-1">
                            {models.map((model) => {
                              const isSelected = selectedModels.includes(model.id);
                              return (
                                <button
                                  key={model.id}
                                  onClick={() => handleToggleModel(model.id)}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono transition-all ${
                                    isSelected
                                      ? "bg-primary text-white"
                                      : "bg-surface border border-border text-text-muted hover:border-primary/50 hover:text-text-main"
                                  }`}
                                  title={model.id}
                                >
                                  {getModelDisplayName(model.id)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        <AllowedResourcesSection
          allCombos={allCombos}
          allConnections={allConnections}
          allowAllCombos={allowAllCombos}
          allowAllConnections={allowAllConnections}
          allowAllEndpoints={allowAllEndpoints}
          handleToggleCombo={handleToggleCombo}
          handleToggleConnection={handleToggleConnection}
          handleToggleEndpoint={handleToggleEndpoint}
          selectedCombos={selectedCombos}
          selectedConnections={selectedConnections}
          selectedEndpoints={selectedEndpoints}
          setAllowAllCombos={setAllowAllCombos}
          setAllowAllConnections={setAllowAllConnections}
          setAllowAllEndpoints={setAllowAllEndpoints}
          setSelectedCombos={setSelectedCombos}
          setSelectedConnections={setSelectedConnections}
          setSelectedEndpoints={setSelectedEndpoints}
          t={t}
          tc={tc}
        />
        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={handleSave} fullWidth>
            {t("savePermissions")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {tc("cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
});
