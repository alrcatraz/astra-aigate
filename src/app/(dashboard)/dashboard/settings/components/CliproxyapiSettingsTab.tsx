"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, Button, Input, Toggle } from "@/shared/components";

interface Settings {
  cliproxyapi_fallback_enabled?: boolean;
  cliproxyapi_url?: string;
  cliproxyapi_fallback_codes?: string;
  settingsRevision?: number;
  [key: string]: unknown;
}

interface VersionManagerEntry {
  tool: string;
  status: string;
  installedVersion: string | null;
  healthStatus: string;
  port: number;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function CliproxyapiSettingsTab() {
  const t = useTranslations("settings");
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [toolState, setToolState] = useState<VersionManagerEntry | null>(null);
  const [toolStateError, setToolStateError] = useState<string | null>(null);
  // #1934: import CLIProxyAPI auth files (~/.cli-proxy-api/) as AI Gate connections.
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // A2: local drafts for the free-text fields so typing does not fire a PATCH
  // per keystroke. Persisted once on blur (SecurityTab.tsx:328-334 pattern).
  const [cpaUrlDraft, setCpaUrlDraft] = useState("http://127.0.0.1:8317");
  const [cpaCodesDraft, setCpaCodesDraft] = useState("502,401,403,429,503");
  // B3: the settings CAS gate (/api/settings PATCH) is exercised by echoing
  // the GET /api/settings `settingsRevision` back in the request body.
  const settingsRevisionRef = useRef<number | undefined>(undefined);

  const handleImportAuth = useCallback(async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/oauth/cliproxy-import", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setImportResult(
          `Imported ${data.imported ?? 0} account(s) (scanned ${data.scanned ?? 0}, skipped ${data.skipped ?? 0}).`
        );
      } else {
        setImportResult(data.error || "Import failed.");
      }
    } catch {
      setImportResult("Import failed.");
    } finally {
      setImporting(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error(`Settings API returned ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSettings(data);
        setCpaUrlDraft(
          typeof data.cliproxyapi_url === "string" && data.cliproxyapi_url.trim() !== ""
            ? data.cliproxyapi_url
            : "http://127.0.0.1:8317"
        );
        setCpaCodesDraft(
          typeof data.cliproxyapi_fallback_codes === "string" &&
            data.cliproxyapi_fallback_codes.trim() !== ""
            ? data.cliproxyapi_fallback_codes
            : "502,401,403,429,503"
        );
        if (typeof data.settingsRevision === "number") {
          settingsRevisionRef.current = data.settingsRevision;
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setLoading(false);
      });

    fetch("/api/version-manager/status")
      .then((r) => {
        if (!r.ok) throw new Error(`Version manager API returned ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const entry = Array.isArray(data)
          ? data.find((t: VersionManagerEntry) => t.tool === "cliproxyapi")
          : null;
        setToolState(entry ?? null);
        setToolStateError(null);
      })
      .catch((err) => {
        console.error("Failed to load version manager status:", err);
        setToolStateError("Unable to reach version manager service");
        setToolState(null);
      });
  }, []);

  const updateSetting = useCallback(async (key: string, value: boolean | string) => {
    if (key === "cliproxyapi_url" && typeof value === "string" && value.trim() !== "") {
      if (!isValidUrl(value)) {
        setMessage({ type: "error", text: "Invalid URL format. Use http:// or https://" });
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      // B3: echo the settings revision back so the server-side CAS gate
      // (settings/route.ts updateSettings expectedRevision) is exercised.
      const body: Record<string, string | boolean | number> = { [key]: value };
      if (typeof settingsRevisionRef.current === "number") {
        body.expectedRevision = settingsRevisionRef.current;
      }
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        // Concurrent change — refresh the revision and retry the write once.
        const fresh = await fetch("/api/settings").then((r) => (r.ok ? r.json() : null));
        if (fresh && typeof fresh.settingsRevision === "number") {
          settingsRevisionRef.current = fresh.settingsRevision;
        }
        const retryBody: Record<string, string | boolean | number> = { [key]: value };
        if (typeof settingsRevisionRef.current === "number") {
          retryBody.expectedRevision = settingsRevisionRef.current;
        }
        const retry = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(retryBody),
        });
        if (!retry.ok) {
          throw new Error(`Server returned ${retry.status}`);
        }
        await retry.json();
        setSettings((prev) => ({ ...prev, [key]: value }));
        setMessage({ type: "success", text: "Setting saved" });
        return;
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const saved = await res.json();
      if (typeof saved.settingsRevision === "number") {
        settingsRevisionRef.current = saved.settingsRevision;
      }
      setSettings((prev) => ({ ...prev, [key]: value }));
      setMessage({ type: "success", text: "Setting saved" });
    } catch {
      setMessage({ type: "error", text: "Failed to save setting" });
    } finally {
      setSaving(false);
    }
  }, []);

  const cpaEnabled = settings.cliproxyapi_fallback_enabled === true;

  const commitUrlDraft = () => {
    const trimmed = cpaUrlDraft.trim();
    updateSetting("cliproxyapi_url", trimmed);
  };
  const commitCodesDraft = () => {
    updateSetting("cliproxyapi_fallback_codes", cpaCodesDraft.trim());
  };

  const statusColor =
    toolState?.status === "running"
      ? "text-green-600 dark:text-green-400"
      : toolState?.status === "error"
        ? "text-red-600 dark:text-red-400"
        : "text-text-muted";

  const statusIcon =
    toolState?.status === "running"
      ? "check_circle"
      : toolState?.status === "error"
        ? "error"
        : "help";

  return (
    <div className="space-y-4">
      {/* Migration banner — new lifecycle management lives in the Services page */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs">
        <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">info</span>
        <span>
          CLIProxyAPI lifecycle management (install, start, stop) has moved to{" "}
          <Link
            href="/dashboard/providers/services"
            className="underline underline-offset-2 hover:opacity-80"
          >
            Providers → Services
          </Link>
          . Fallback routing settings below remain here.
        </span>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
            message.type === "success"
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">
            {message.type === "success" ? "check_circle" : "error"}
          </span>
          {message.text}
        </div>
      )}

      <Card padding="md">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-8 rounded-lg flex items-center justify-center bg-indigo-500/10">
            <span className="material-symbols-outlined text-indigo-500 text-xl">swap_horiz</span>
          </div>
          <div>
            <h3 className="font-medium text-sm">{t("cliproxyapiFallback")}</h3>
            <p className="text-xs text-text-muted">
              When enabled, failed requests are retried through CLIProxyAPI (localhost:8317)
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm text-text-main">{t("cliproxyapiEnableFallback")}</label>
            <Toggle
              checked={cpaEnabled}
              onChange={(checked) => updateSetting("cliproxyapi_fallback_enabled", checked)}
            />
          </div>

          {cpaEnabled && (
            <>
              <div>
                <label className="text-xs text-text-muted mb-1.5 block">
                  {t("cliproxyapiUrl")}
                </label>
                <Input
                  value={cpaUrlDraft}
                  onChange={(e) => setCpaUrlDraft(e.target.value)}
                  onBlur={commitUrlDraft}
                  placeholder="http://127.0.0.1:8317"
                  className="w-full"
                />
              </div>

              <div>
                <label className="text-xs text-text-muted mb-1.5 block">
                  Fallback Status Codes (comma-separated)
                </label>
                <Input
                  value={cpaCodesDraft}
                  onChange={(e) => setCpaCodesDraft(e.target.value)}
                  onBlur={commitCodesDraft}
                  placeholder="502,401,403,429,503"
                  className="w-full"
                />
              </div>
            </>
          )}
        </div>
      </Card>

      <Card padding="md">
        <h3 className="font-medium text-sm mb-4">{t("cliproxyapiStatus")}</h3>
        {loading ? (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <span className="material-symbols-outlined animate-spin text-base">
              progress_activity
            </span>
            Loading...
          </div>
        ) : toolStateError ? (
          <p className="text-sm text-text-muted">{toolStateError}</p>
        ) : toolState ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-bg-secondary">
              <p className="text-xs text-text-muted mb-1">Status</p>
              <div className="flex items-center gap-1.5">
                <span className={`material-symbols-outlined text-sm ${statusColor}`}>
                  {statusIcon}
                </span>
                <p className={`text-sm font-medium capitalize ${statusColor}`}>
                  {toolState.status?.replace("_", " ") || "Unknown"}
                </p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-bg-secondary">
              <p className="text-xs text-text-muted mb-1">Version</p>
              <p className="text-sm font-medium">
                {toolState.installedVersion ? `v${toolState.installedVersion}` : "Not installed"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-bg-secondary">
              <p className="text-xs text-text-muted mb-1">Health</p>
              <p
                className={`text-sm font-medium ${
                  toolState.healthStatus === "healthy"
                    ? "text-green-600 dark:text-green-400"
                    : toolState.healthStatus === "unhealthy"
                      ? "text-red-600 dark:text-red-400"
                      : "text-text-muted"
                }`}
              >
                {toolState.healthStatus === "healthy"
                  ? "Healthy"
                  : toolState.healthStatus === "unhealthy"
                    ? "Unhealthy"
                    : "Unknown"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-bg-secondary">
              <p className="text-xs text-text-muted mb-1">Port</p>
              <p className="text-sm font-mono">{toolState.port || 8317}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">{t("cliproxyapiNotDetected")}</p>
        )}
      </Card>

      <Card padding="md">
        <h3 className="text-lg font-semibold mb-1">{t("cliproxyapiImportAuthTitle")}</h3>
        <p className="text-sm text-text-muted mb-3">{t("cliproxyapiImportAuthDesc")}</p>
        <Button onClick={handleImportAuth} loading={importing} disabled={importing}>
          {t("cliproxyapiImportAuthButton")}
        </Button>
        {importResult ? (
          <p className="text-sm text-text-muted mt-3" role="status">
            {importResult}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
