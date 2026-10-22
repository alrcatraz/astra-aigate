"use client";

/**
 * AllowedResourcesSection — split out of PermissionsModal.tsx for the size gate.
 */

import { compareTr } from "@/shared/utils/turkishText";
import { ENDPOINT_CATEGORIES } from "@/shared/constants/endpointCategories";
import type { ProviderConnection } from "../apiManagerShared";
import type {
  PermissionsModalFormParams,
  usePermissionsModalForm,
} from "./usePermissionsModalForm";

type Form = ReturnType<typeof usePermissionsModalForm>;

export function AllowedResourcesSection({
  allCombos,
  allConnections,
  allowAllCombos,
  allowAllConnections,
  allowAllEndpoints,
  handleToggleCombo,
  handleToggleConnection,
  handleToggleEndpoint,
  selectedCombos,
  selectedConnections,
  selectedEndpoints,
  setAllowAllCombos,
  setAllowAllConnections,
  setAllowAllEndpoints,
  setSelectedCombos,
  setSelectedConnections,
  setSelectedEndpoints,
  t,
  tc,
}: Pick<
  Form,
  | "allowAllCombos"
  | "allowAllConnections"
  | "allowAllEndpoints"
  | "handleToggleCombo"
  | "handleToggleConnection"
  | "handleToggleEndpoint"
  | "selectedCombos"
  | "selectedConnections"
  | "selectedEndpoints"
  | "setAllowAllCombos"
  | "setAllowAllConnections"
  | "setAllowAllEndpoints"
  | "setSelectedCombos"
  | "setSelectedConnections"
  | "setSelectedEndpoints"
  | "t"
  | "tc"
> &
  Pick<PermissionsModalFormParams, "allCombos" | "allConnections">) {
  return (
    <>
      {/* Allowed Connections Section */}
      {allConnections.length > 0 && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-main">{t("allowedConnections")}</p>
            <div className="flex gap-1 p-0.5 bg-surface rounded-md">
              <button
                onClick={() => {
                  setAllowAllConnections(true);
                  setSelectedConnections([]);
                }}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                  allowAllConnections
                    ? "bg-primary text-white"
                    : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setAllowAllConnections(false)}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                  !allowAllConnections
                    ? "bg-primary text-white"
                    : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                Restrict
              </button>
            </div>
          </div>
          <p className="text-xs text-text-muted">
            {allowAllConnections
              ? "This key can use any active connection."
              : `Restricted to ${selectedConnections.length} connection${selectedConnections.length !== 1 ? "s" : ""}.`}
          </p>
          {!allowAllConnections && (
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {Object.entries(
                allConnections.reduce<Record<string, ProviderConnection[]>>((acc, conn) => {
                  const p = conn.provider || "Other";
                  if (!acc[p]) acc[p] = [];
                  acc[p].push(conn);
                  return acc;
                }, {})
              )
                .sort(([a], [b]) => compareTr(a, b))
                .map(([provider, conns]) => (
                  <div key={provider}>
                    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-1 py-0.5">
                      {provider}
                    </p>
                    {conns.map((conn) => {
                      const isSelected = selectedConnections.includes(conn.id);
                      return (
                        <button
                          key={conn.id}
                          onClick={() => handleToggleConnection(conn.id)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                            isSelected
                              ? "bg-primary/10 text-primary"
                              : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                          }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                              isSelected ? "bg-primary border-primary" : "border-border"
                            }`}
                          >
                            {isSelected && (
                              <span className="material-symbols-outlined text-white text-[10px]">
                                check
                              </span>
                            )}
                          </div>
                          <span className="truncate flex-1">
                            {conn.name || conn.id.slice(0, 8)}
                          </span>
                          {!conn.isActive && (
                            <span className="text-[9px] text-red-400 shrink-0">
                              {tc("inactive")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Allowed Combos Section */}
      {allCombos.length > 0 && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-main">{t("allowedCombos")}</p>
            <div className="flex gap-1 p-0.5 bg-surface rounded-md">
              <button
                onClick={() => {
                  setAllowAllCombos(true);
                  setSelectedCombos([]);
                }}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                  allowAllCombos
                    ? "bg-primary text-white"
                    : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {tc("all")}
              </button>
              <button
                onClick={() => setAllowAllCombos(false)}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                  !allowAllCombos
                    ? "bg-primary text-white"
                    : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {t("restrict")}
              </button>
            </div>
          </div>
          <p className="text-xs text-text-muted">
            {allowAllCombos
              ? t("allCombosAllowed")
              : t("restrictedComboCount", { count: selectedCombos.length })}
          </p>
          {!allowAllCombos && (
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {allCombos
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((combo) => {
                  const isSelected = selectedCombos.includes(combo.name);
                  return (
                    <button
                      key={combo.id || combo.name}
                      onClick={() => handleToggleCombo(combo.name)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                        isSelected
                          ? "bg-primary/10 text-primary"
                          : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                          isSelected ? "bg-primary border-primary" : "border-border"
                        }`}
                      >
                        {isSelected && (
                          <span className="material-symbols-outlined text-white text-[10px]">
                            check
                          </span>
                        )}
                      </div>
                      <span className="truncate flex-1">{combo.name}</span>
                      {Array.isArray(combo.models) && (
                        <span className="text-[10px] text-text-muted shrink-0">
                          {combo.models.length} models
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Allowed Endpoints Section */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("endpointRestrictions")}</p>
            <p className="text-xs text-text-muted">
              {allowAllEndpoints
                ? t("allEndpointsAllowed")
                : t("endpointsRestricted", {
                    count: selectedEndpoints.length,
                  })}
            </p>
          </div>
          <div className="flex gap-1 p-0.5 bg-surface rounded-md">
            <button
              onClick={() => {
                setAllowAllEndpoints(true);
                setSelectedEndpoints([]);
              }}
              className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                allowAllEndpoints
                  ? "bg-primary text-white"
                  : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {t("all")}
            </button>
            <button
              onClick={() => setAllowAllEndpoints(false)}
              className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                !allowAllEndpoints
                  ? "bg-primary text-white"
                  : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              {t("restrict")}
            </button>
          </div>
        </div>
        {!allowAllEndpoints && (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {ENDPOINT_CATEGORIES.map((cat) => {
              const isSelected = selectedEndpoints.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => handleToggleEndpoint(cat.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                    isSelected
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      isSelected ? "bg-primary border-primary" : "border-border"
                    }`}
                  >
                    {isSelected && (
                      <span className="material-symbols-outlined text-white text-[10px]">
                        check
                      </span>
                    )}
                  </div>
                  <span className="truncate flex-1">{cat.label}</span>
                  <span className="text-[10px] text-text-muted shrink-0 truncate max-w-[140px]">
                    {cat.description}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
