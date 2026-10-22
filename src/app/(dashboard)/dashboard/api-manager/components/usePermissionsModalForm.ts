"use client";

/**
 * Form state and handlers for the API-key permissions modal,
 * extracted from PermissionsModal.tsx so both files stay under
 * the size gate.
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

export type PermissionsModalFormParams = {
  isOpen: boolean;
  onClose: () => void;
  apiKey: ApiKey;
  modelsByProvider: ProviderGroup[];
  allModels: Model[];
  modelsLoaded: boolean;
  allCombos: ComboOption[];
  allConnections: ProviderConnection[];
  searchModel: string;
  onSearchChange: (v: string) => void;
  proxiedServices: { id: string; name: string }[];
  onSave: (
    name: string,
    models: string[],
    combos: string[],
    noLog: boolean,
    connections: string[],
    autoResolve: boolean,
    isActive: boolean,
    throttleDelayMs: number,
    isBanned: boolean,
    expiresAt: string | null,
    maxSessions: number,
    accessSchedule: AccessSchedule | null,
    rateLimits: Array<{ limit: number; window: number }> | null,
    scopes: string[],
    allowedEndpoints: string[],
    streamDefaultMode: StreamDefaultMode,
    disableNonPublicModels: boolean,
    allowUsageCommand: boolean,
    usageLimitEnabled: boolean,
    dailyUsageLimitUsd: number | null,
    weeklyUsageLimitUsd: number | null,
    blockedModels: string[],
    chaosModeEnabled: boolean
  ) => void;
};

export function usePermissionsModalForm({
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
  const t = useTranslations("apiManager");
  const tc = useTranslations("common");

  // Initialize state from props - component remounts when key prop changes
  const initialModels = Array.isArray(apiKey?.allowedModels) ? apiKey.allowedModels : [];
  const initialBlockedModels = useMemo(
    () => (Array.isArray(apiKey?.blockedModels) ? apiKey.blockedModels : []),
    [apiKey?.blockedModels]
  );
  const initialCombos = Array.isArray(apiKey?.allowedCombos) ? apiKey.allowedCombos : [];
  const initialConnections = Array.isArray(apiKey?.allowedConnections)
    ? apiKey.allowedConnections
    : [];
  const [keyName, setKeyName] = useState(apiKey?.name ?? "");
  const [selectedModels, setSelectedModels] = useState<string[]>(initialModels);
  const [blockedClaudeCodeFamilies, setBlockedClaudeCodeFamilies] = useState<
    ClaudeCodeBlockableFamilyId[]
  >(() => getBlockedClaudeCodeFamilies(initialBlockedModels));
  const [claudeCodeFamiliesExpanded, setClaudeCodeFamiliesExpanded] = useState(false);
  const [selectedCombos, setSelectedCombos] = useState<string[]>(initialCombos);
  const [allowAll, setAllowAll] = useState(initialModels.length === 0);
  const [allowAllCombos, setAllowAllCombos] = useState(initialCombos.length === 0);
  const [noLogEnabled, setNoLogEnabled] = useState(apiKey?.noLog === true);
  const [autoResolveEnabled, setAutoResolveEnabled] = useState(apiKey?.autoResolve === true);
  const [keyIsActive, setKeyIsActive] = useState(apiKey?.isActive !== false);
  const [throttleDelayMs, setThrottleDelayMs] = useState(
    typeof apiKey?.throttleDelayMs === "number" && apiKey.throttleDelayMs > 0
      ? apiKey.throttleDelayMs
      : 0
  );
  const [keyIsBanned, setKeyIsBanned] = useState(apiKey?.isBanned === true);
  const [expiresAt, setExpiresAt] = useState(apiKey?.expiresAt ?? "");
  const [manageEnabled, setManageEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes("manage")
  );
  const [mcpAdminEnabled, setMcpAdminEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(MCP_ADMIN_SCOPE)
  );
  const [mcpReadEnabled, setMcpReadEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(MCP_READ_SCOPE)
  );
  const [mcpWriteEnabled, setMcpWriteEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(MCP_WRITE_SCOPE)
  );
  const [serviceScopesEnabled, setServiceScopesEnabled] = useState<Record<string, boolean>>({});

  // Initialise Service Access toggles from the key's existing svc:* scopes
  // whenever the proxied-services list (fetched once by the parent) or the
  // edited key changes.
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const s of proxiedServices) {
      initial[s.id] = Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(`svc:${s.id}`);
    }
    setServiceScopesEnabled(initial);
  }, [proxiedServices, apiKey]);
  const [selfUsageEnabled, setSelfUsageEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(SELF_USAGE_SCOPE)
  );
  const [selfAccountQuotaEnabled, setSelfAccountQuotaEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(SELF_ACCOUNT_QUOTA_SCOPE)
  );
  const [bypassProviderQuotaPolicyEnabled, setBypassProviderQuotaPolicyEnabled] = useState(
    hasProviderQuotaBypassScope(apiKey?.scopes)
  );
  const [maxSessions, setMaxSessions] = useState(
    typeof apiKey?.maxSessions === "number" && apiKey.maxSessions > 0 ? apiKey.maxSessions : 0
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(apiKey?.accessSchedule?.enabled === true);
  const [scheduleFrom, setScheduleFrom] = useState(apiKey?.accessSchedule?.from ?? "08:00");
  const [scheduleUntil, setScheduleUntil] = useState(apiKey?.accessSchedule?.until ?? "18:00");
  const [scheduleDays, setScheduleDays] = useState<number[]>(
    apiKey?.accessSchedule?.days ?? [1, 2, 3, 4, 5]
  );
  const [scheduleTz, setScheduleTz] = useState(
    apiKey?.accessSchedule?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [rateLimits, setRateLimits] = useState<Array<{ limit: number; window: number }>>(
    Array.isArray(apiKey?.rateLimits) ? apiKey.rateLimits : []
  );
  const [streamDefaultMode, setStreamDefaultMode] = useState<StreamDefaultMode>(
    apiKey?.streamDefaultMode === "json" ? "json" : "legacy"
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedConnections, setSelectedConnections] = useState<string[]>(initialConnections);
  const [allowAllConnections, setAllowAllConnections] = useState(initialConnections.length === 0);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(() => {
    // Expand all providers by default when in restrict mode with existing selections
    if (initialModels.length > 0) {
      return new Set(modelsByProvider.map(([p]) => p));
    }
    return new Set();
  });

  const initialEndpoints = Array.isArray(apiKey?.allowedEndpoints) ? apiKey.allowedEndpoints : [];
  const [selectedEndpoints, setSelectedEndpoints] = useState<string[]>(initialEndpoints);
  const [allowAllEndpoints, setAllowAllEndpoints] = useState(initialEndpoints.length === 0);
  const [disableNonPublicModels, setDisableNonPublicModels] = useState(
    apiKey?.disableNonPublicModels === true
  );
  const [usageCommandEnabled, setUsageCommandEnabled] = useState(
    apiKey?.allowUsageCommand === true
  );
  const [chaosModeEnabled, setChaosModeEnabled] = useState(apiKey?.chaosModeEnabled === true);
  const [usageLimitEnabled, setUsageLimitEnabled] = useState(apiKey?.usageLimitEnabled === true);
  const [dailyUsageLimitUsd, setDailyUsageLimitUsd] = useState(
    typeof apiKey?.dailyUsageLimitUsd === "number" && apiKey.dailyUsageLimitUsd > 0
      ? String(apiKey.dailyUsageLimitUsd)
      : ""
  );
  const [weeklyUsageLimitUsd, setWeeklyUsageLimitUsd] = useState(
    typeof apiKey?.weeklyUsageLimitUsd === "number" && apiKey.weeklyUsageLimitUsd > 0
      ? String(apiKey.weeklyUsageLimitUsd)
      : ""
  );
  const getModelDisplayName = useCallback(
    (modelId: string) =>
      modelId === CLAUDE_CODE_DEFAULT_MODEL_ID ? CLAUDE_CODE_DEFAULT_MODEL_NAME : modelId,
    []
  );

  // Memoize callbacks to prevent child re-renders
  const handleToggleModel = useCallback(
    (modelId: string) => {
      if (allowAll) return;

      setSelectedModels((prev) => {
        if (prev.includes(modelId)) {
          if (modelId === CLAUDE_CODE_DEFAULT_MODEL_ID) {
            setClaudeCodeFamiliesExpanded(false);
          }
          return prev.filter((m) => m !== modelId);
        }
        return [...prev, modelId];
      });
    },
    [allowAll]
  );

  const handleToggleProvider = useCallback(
    (provider: string, models: Model[]) => {
      if (allowAll) return;

      const modelIds = models.map((m) => m.id);
      setSelectedModels((prev) => {
        const allSelected = modelIds.every((id) => prev.includes(id));
        if (allSelected) {
          return prev.filter((m) => !modelIds.includes(m));
        }
        return [...new Set([...prev, ...modelIds])];
      });
    },
    [allowAll]
  );

  const handleSelectAll = useCallback(() => {
    setAllowAll(true);
    setSelectedModels([]);
    setBlockedClaudeCodeFamilies([]);
    setClaudeCodeFamiliesExpanded(false);
  }, []);

  const handleRestrictMode = useCallback(() => {
    setAllowAll(false);
    // Expand all providers when entering restrict mode
    const allProviders = new Set(modelsByProvider.map(([p]) => p));
    setExpandedProviders(allProviders);
  }, [modelsByProvider]);

  const handleToggleExpand = useCallback((provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  }, []);

  const handleSelectAllModels = useCallback(() => {
    const allModelIds = allModels.map((m) => m.id);
    setSelectedModels(allModelIds);
    setBlockedClaudeCodeFamilies([]);
    setClaudeCodeFamiliesExpanded(false);
  }, [allModels]);

  const handleDeselectAllModels = useCallback(() => {
    setSelectedModels([]);
    setBlockedClaudeCodeFamilies([]);
    setClaudeCodeFamiliesExpanded(false);
  }, []);

  const handleBlockClaudeCodeFamily = useCallback((familyId: ClaudeCodeBlockableFamilyId) => {
    setBlockedClaudeCodeFamilies((prev) => (prev.includes(familyId) ? prev : [...prev, familyId]));
    setSelectedModels((prev) =>
      prev.filter((modelId) => !isClaudeCodeFamilyModel(modelId, familyId))
    );
  }, []);

  const handleToggleCombo = useCallback(
    (comboName: string) => {
      if (allowAllCombos) return;
      setSelectedCombos((prev) =>
        prev.includes(comboName) ? prev.filter((name) => name !== comboName) : [...prev, comboName]
      );
    },
    [allowAllCombos]
  );

  const handleToggleConnection = useCallback(
    (connectionId: string) => {
      if (allowAllConnections) return;
      setSelectedConnections((prev) =>
        prev.includes(connectionId)
          ? prev.filter((c) => c !== connectionId)
          : [...prev, connectionId]
      );
    },
    [allowAllConnections]
  );

  const handleToggleEndpoint = useCallback(
    (categoryId: string) => {
      if (allowAllEndpoints) return;
      setSelectedEndpoints((prev) =>
        prev.includes(categoryId) ? prev.filter((e) => e !== categoryId) : [...prev, categoryId]
      );
    },
    [allowAllEndpoints]
  );

  const parseUsdLimitInput = useCallback((value: string): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, []);

  const handleSave = useCallback(() => {
    // Clear previous inline errors
    setNameError(null);
    setSaveError(null);

    // Validate name inline before calling onSave
    const validation = validateKeyName(keyName, t);
    if (!validation.valid) {
      setNameError(validation.error || t("invalidKeyName"));
      return;
    }

    // Validate models selection
    if (!allowAll && !Array.isArray(selectedModels)) {
      setSaveError(t("invalidModelsSelection"));
      return;
    }

    // Limit number of selected models to prevent abuse
    if (!allowAll && selectedModels.length > MAX_SELECTED_MODELS) {
      setSaveError(t("cannotSelectMoreThanModels", { max: MAX_SELECTED_MODELS }));
      return;
    }

    const schedule: AccessSchedule | null = scheduleEnabled
      ? {
          enabled: true,
          from: scheduleFrom,
          until: scheduleUntil,
          days: scheduleDays,
          tz: scheduleTz,
        }
      : null;
    const hasClaudeCodeDefaultSelected =
      !allowAll && selectedModels.includes(CLAUDE_CODE_DEFAULT_MODEL_ID);
    const blockedModels = initialBlockedModels.filter(
      (pattern) => !CLAUDE_CODE_BLOCK_PATTERN_SET.has(pattern)
    );
    if (hasClaudeCodeDefaultSelected) {
      for (const familyId of blockedClaudeCodeFamilies) {
        blockedModels.push(...CLAUDE_CODE_FAMILY_BLOCK_PATTERNS[familyId]);
      }
    }
    onSave(
      keyName,
      allowAll ? [] : selectedModels,
      allowAllCombos ? [] : selectedCombos,
      noLogEnabled,
      allowAllConnections ? [] : selectedConnections,
      autoResolveEnabled,
      keyIsActive,
      throttleDelayMs,
      keyIsBanned,
      expiresAt || null,
      maxSessions,
      schedule,
      rateLimits.length > 0 ? rateLimits : null,
      mergeApiKeyPermissionScopes(apiKey?.scopes, {
        manageEnabled,
        selfUsageEnabled,
        selfAccountQuotaEnabled,
        bypassProviderQuotaPolicyEnabled,
        mcpAdminEnabled,
        mcpReadEnabled,
        mcpWriteEnabled,
        serviceScopes: Object.entries(serviceScopesEnabled)
          .filter(([, enabled]) => enabled)
          .map(([id]) => `svc:${id}`),
      }),
      allowAllEndpoints ? [] : selectedEndpoints,
      streamDefaultMode,
      disableNonPublicModels,
      usageCommandEnabled,
      usageLimitEnabled,
      parseUsdLimitInput(dailyUsageLimitUsd),
      parseUsdLimitInput(weeklyUsageLimitUsd),
      blockedModels,
      chaosModeEnabled
    );
  }, [
    onSave,
    keyName,
    allowAll,
    selectedModels,
    allowAllCombos,
    selectedCombos,
    noLogEnabled,
    allowAllConnections,
    selectedConnections,
    autoResolveEnabled,
    keyIsActive,
    throttleDelayMs,
    keyIsBanned,
    expiresAt,
    maxSessions,
    manageEnabled,
    selfUsageEnabled,
    selfAccountQuotaEnabled,
    bypassProviderQuotaPolicyEnabled,
    mcpAdminEnabled,
    mcpReadEnabled,
    mcpWriteEnabled,
    serviceScopesEnabled,
    scheduleEnabled,
    scheduleFrom,
    scheduleUntil,
    scheduleDays,
    scheduleTz,
    rateLimits,
    allowAllEndpoints,
    selectedEndpoints,
    streamDefaultMode,
    disableNonPublicModels,
    usageCommandEnabled,
    usageLimitEnabled,
    dailyUsageLimitUsd,
    weeklyUsageLimitUsd,
    parseUsdLimitInput,
    blockedClaudeCodeFamilies,
    initialBlockedModels,
    chaosModeEnabled,
    apiKey?.scopes,
    t,
  ]);

  const selectedCount = selectedModels.length;
  const totalModels = allModels.length;
  const hasClaudeCodeDefaultSelected =
    !allowAll && selectedModels.includes(CLAUDE_CODE_DEFAULT_MODEL_ID);
  const orderedSelectedModels = useMemo(() => {
    if (!hasClaudeCodeDefaultSelected) return selectedModels;
    return [
      CLAUDE_CODE_DEFAULT_MODEL_ID,
      ...selectedModels.filter((modelId) => modelId !== CLAUDE_CODE_DEFAULT_MODEL_ID),
    ];
  }, [hasClaudeCodeDefaultSelected, selectedModels]);
  const visibleClaudeCodeFamilies = useMemo(
    () =>
      CLAUDE_CODE_DEFAULT_FAMILIES.filter(
        (family) =>
          family.id === "other" ||
          !blockedClaudeCodeFamilies.includes(family.id as ClaudeCodeBlockableFamilyId)
      ),
    [blockedClaudeCodeFamilies]
  );

  return {
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
  };
}
