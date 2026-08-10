"use client";

import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/shared/components";

/** skill_sources 表返回的源实例（对齐 src/lib/skills/sourceKind.ts SkillSourceInstance）。 */
interface SkillSource {
  id: string;
  kind: string;
  name: string;
  url?: string;
  skillsPath: string;
  credentialRef?: string;
  autoUpdate: boolean;
  lastSyncAt?: string;
  enabled: boolean;
  createdAt?: string;
}

/** /api/skills/sources/:id/discover 返回的 skill 元数据。 */
interface DiscoveredSkill {
  name: string;
  version?: string;
  description?: string;
  externalId?: string;
  ref?: string;
  tags?: string[];
}

interface OmniSourcesTabProps {
  onRefreshSkills: () => Promise<void>;
}

const BUILTIN_ID = "omniroute::builtin";

export function OmniSourcesTab({ onRefreshSkills }: OmniSourcesTabProps): JSX.Element {
  const t = useTranslations("skills");

  // 源列表 state
  const [sources, setSources] = useState<SkillSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [error, setError] = useState("");

  // 登记表单 state
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [regKind, setRegKind] = useState<"github-public" | "gitea">("gitea");
  const [regName, setRegName] = useState("");
  const [regUrl, setRegUrl] = useState("");
  const [regPath, setRegPath] = useState("skills");
  const [regCredential, setRegCredential] = useState("");
  const [regAuto, setRegAuto] = useState(false);
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState("");
  const [regSuccess, setRegSuccess] = useState(false);

  // discover/install state：按源 id 隔离
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<Record<string, DiscoveredSkill[]>>({});
  const [discoverError, setDiscoverError] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<
    Record<string, { type: "success" | "error"; text: string }>
  >({});

  const loadSources = useCallback(async () => {
    setLoadingSources(true);
    setError("");
    try {
      const res = await fetch("/api/skills/sources");
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error || "Failed to load sources");
        setSources([]);
      } else {
        setSources((data as { sources?: SkillSource[] }).sources || (data as SkillSource[]) || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const registerSource = async () => {
    setRegSubmitting(true);
    setRegError("");
    setRegSuccess(false);
    try {
      const res = await fetch("/api/skills/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: regKind,
          name: regName,
          url: regUrl,
          skillsPath: regPath || "skills",
          credentialRef: regCredential || undefined,
          autoUpdate: regAuto,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegError((data as { error?: string }).error || "Failed to register source");
      } else {
        setRegSuccess(true);
        setRegName("");
        setRegUrl("");
        setRegPath("skills");
        setRegCredential("");
        setRegAuto(false);
        setShowRegisterForm(false);
        await loadSources();
      }
    } catch (err) {
      setRegError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegSubmitting(false);
    }
  };

  const toggleSourceEnabled = async (src: SkillSource) => {
    // 内置源只读锁死，前端直接禁用按钮（后端也有 403 兜底）
    if (src.id === BUILTIN_ID) return;
    try {
      const res = await fetch(`/api/skills/sources/${src.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !src.enabled }),
      });
      if (res.ok) {
        setSources((prev) =>
          prev.map((s) => (s.id === src.id ? { ...s, enabled: !s.enabled } : s))
        );
      } else {
        const data = await res.json();
        setActionMsg((m) => ({
          ...m,
          [src.id]: { type: "error", text: (data as { error?: string }).error || "Failed" },
        }));
      }
    } catch (err) {
      setActionMsg((m) => ({
        ...m,
        [src.id]: { type: "error", text: err instanceof Error ? err.message : String(err) },
      }));
    }
  };

  const deleteSource = async (src: SkillSource) => {
    if (src.id === BUILTIN_ID) return;
    if (!window.confirm(t("confirmDeleteSource", { name: src.name }))) return;
    try {
      const res = await fetch(`/api/skills/sources/${src.id}`, { method: "DELETE" });
      if (res.ok) {
        setSources((prev) => prev.filter((s) => s.id !== src.id));
        setDiscovered((d) => {
          const n = { ...d };
          delete n[src.id];
          return n;
        });
      } else {
        const data = await res.json();
        setActionMsg((m) => ({
          ...m,
          [src.id]: { type: "error", text: (data as { error?: string }).error || "Failed" },
        }));
      }
    } catch (err) {
      setActionMsg((m) => ({
        ...m,
        [src.id]: { type: "error", text: err instanceof Error ? err.message : String(err) },
      }));
    }
  };

  const discoverSource = async (src: SkillSource) => {
    setDiscovering(src.id);
    setDiscoverError((e) => ({ ...e, [src.id]: "" }));
    setDiscovered((d) => ({ ...d, [src.id]: [] }));
    try {
      const res = await fetch(`/api/skills/sources/${src.id}/discover`);
      const data = await res.json();
      if (!res.ok) {
        setDiscoverError((e) => ({
          ...e,
          [src.id]: (data as { error?: string }).error || "Discover failed",
        }));
      } else {
        setDiscovered((d) => ({
          ...d,
          [src.id]: (data as { skills?: DiscoveredSkill[] }).skills || [],
        }));
      }
    } catch (err) {
      setDiscoverError((e) => ({
        ...e,
        [src.id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setDiscovering(null);
    }
  };

  const installSkill = async (src: SkillSource, skill: DiscoveredSkill) => {
    const key = `${src.id}::${skill.name}`;
    setInstalling(key);
    try {
      const res = await fetch(`/api/skills/sources/${src.id}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: skill.name,
          externalId: skill.externalId,
          version: skill.version,
          description: skill.description,
        }),
      });
      const data = await res.json();
      setActionMsg((m) => ({
        ...m,
        [key]:
          res.ok && (data as { success?: boolean }).success
            ? { type: "success", text: (data as { message?: string }).message || "Installed" }
            : { type: "error", text: (data as { error?: string }).error || "Install failed" },
      }));
      if (res.ok) {
        await onRefreshSkills();
      }
    } catch (err) {
      setActionMsg((m) => ({
        ...m,
        [key]: { type: "error", text: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setInstalling(null);
    }
  };

  const kindLabel = (kind: string): string => {
    switch (kind) {
      case "gitea":
        return "Gitea";
      case "github-public":
        return "GitHub";
      case "github-search":
        return "GitHub Search";
      case "skillssh":
        return "skills.sh";
      case "skillsmp":
        return "SkillsMP";
      case "local":
        return "Local";
      case "omniroute-builtin":
        return "Built-in";
      default:
        return kind;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Card>
          <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">{error}</div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("sourcesTitle")}</h3>
        <button
          onClick={() => {
            setShowRegisterForm((v) => !v);
            setRegSuccess(false);
            setRegError("");
          }}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors"
        >
          {showRegisterForm ? t("cancel") : t("registerSourceButton")}
        </button>
      </div>

      {/* 登记表单 */}
      {showRegisterForm && (
        <Card>
          <div className="grid gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">{t("sourceKindLabel")}</label>
              <select
                value={regKind}
                onChange={(e) => setRegKind(e.target.value as "github-public" | "gitea")}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="gitea">Gitea</option>
                <option value="github-public">GitHub</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">{t("sourceNameLabel")}</label>
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder={t("sourceNamePlaceholder")}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">{t("sourceUrlLabel")}</label>
              <input
                type="text"
                value={regUrl}
                onChange={(e) => setRegUrl(e.target.value)}
                placeholder={t("sourceUrlPlaceholder")}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">{t("sourcePathLabel")}</label>
              <input
                type="text"
                value={regPath}
                onChange={(e) => setRegPath(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                {t("sourceCredentialLabel")}
              </label>
              <input
                type="text"
                value={regCredential}
                onChange={(e) => setRegCredential(e.target.value)}
                placeholder={t("sourceCredentialPlaceholder")}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-text-main">
              <input
                type="checkbox"
                checked={regAuto}
                onChange={(e) => setRegAuto(e.target.checked)}
                className="accent-violet-500"
              />
              {t("autoUpdateLabel")}
            </label>
            {regError && (
              <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">{regError}</div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => void registerSource()}
                disabled={regSubmitting || !regName || !regUrl}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
              >
                {regSubmitting ? t("registering") : t("registerButton")}
              </button>
            </div>
          </div>
        </Card>
      )}

      {loadingSources ? (
        <Card>
          <div className="text-center py-6 text-text-muted">{t("loading")}...</div>
        </Card>
      ) : sources.length === 0 ? (
        <Card>
          <div className="text-center py-8 text-text-muted">{t("noSources")}</div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {sources.map((src) => {
            const isBuiltin = src.id === BUILTIN_ID;
            const discoveredForSrc = discovered[src.id] || [];
            const msgForSrc = actionMsg[src.id];
            return (
              <Card key={src.id}>
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                            isBuiltin
                              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                              : "bg-violet-500/10 text-violet-300"
                          }`}
                        >
                          {kindLabel(src.kind)}
                        </span>
                        <h4 className="font-semibold truncate">{src.name}</h4>
                        {isBuiltin && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface/60 text-text-muted">
                            read-only
                          </span>
                        )}
                        <span className="text-xs text-text-muted truncate">
                          {src.url || src.skillsPath}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                        <span>
                          {t("enabledLabel")}: {src.enabled ? t("yes") : t("no")}
                        </span>
                        <span>
                          {t("autoUpdateLabel")}: {src.autoUpdate ? t("yes") : t("no")}
                        </span>
                        {src.lastSyncAt && (
                          <span>{t("lastSync", { at: src.lastSyncAt.slice(0, 10) })}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isBuiltin && (
                        <>
                          <button
                            onClick={() => void toggleSourceEnabled(src)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-muted hover:text-text-main transition-colors"
                          >
                            {src.enabled ? t("disableSource") : t("enableSource")}
                          </button>
                          <button
                            onClick={() => void deleteSource(src)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            {t("deleteSource")}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => void discoverSource(src)}
                        disabled={discovering === src.id || !src.enabled}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
                      >
                        {discovering === src.id ? t("searching") : t("discoverButton")}
                      </button>
                    </div>
                  </div>

                  {msgForSrc && (
                    <div
                      className={`p-2.5 rounded-lg text-sm ${
                        msgForSrc.type === "success"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {msgForSrc.text}
                    </div>
                  )}

                  {discoverError[src.id] && (
                    <div className="p-2.5 rounded-lg bg-red-500/10 text-red-400 text-sm">
                      {discoverError[src.id]}
                    </div>
                  )}

                  {discoveredForSrc.length > 0 && (
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      {discoveredForSrc.map((skill) => {
                        const key = `${src.id}::${skill.name}`;
                        const skillMsg = actionMsg[key];
                        return (
                          <div
                            key={skill.name}
                            className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-2.5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-text-main truncate">
                                  {skill.name}
                                </span>
                                {skill.version && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface/60 text-text-muted shrink-0">
                                    v{skill.version}
                                  </span>
                                )}
                              </div>
                              {skill.description && (
                                <p className="text-xs text-text-muted mt-0.5 line-clamp-1">
                                  {skill.description}
                                </p>
                              )}
                              {skillMsg && (
                                <p
                                  className={`text-xs mt-1 ${
                                    skillMsg.type === "success"
                                      ? "text-emerald-400"
                                      : "text-red-400"
                                  }`}
                                >
                                  {skillMsg.text}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => void installSkill(src, skill)}
                              disabled={installing === key}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors shrink-0"
                            >
                              {installing === key ? t("installing") : t("installSkillButton")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default OmniSourcesTab;
