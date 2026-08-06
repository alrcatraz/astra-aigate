"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Button, Input, Select, Toggle, Badge, ConfirmModal } from "@/shared/components";

interface McpServerRow {
  id: string;
  name: string;
  kind: "builtin" | "stdio" | "http";
  group_id: string;
  enabled: boolean;
  system: boolean;
  source: string;
  required_scope: string | null;
  auth_type: string | null;
  url: string | null;
  command: string | null;
  args: string | null;
  auth_secret: string | null;
}

interface ProbeResult {
  id: string;
  kind: string;
  domain: string | null;
  ready: boolean;
  error: string | null;
  bridge: string;
  tools: number;
}

const EMPTY_FORM = {
  name: "",
  kind: "http" as "builtin" | "stdio" | "http",
  url: "",
  command: "",
  args: "",
  auth_type: "none",
  auth_secret: "",
};

export default function McpServersPageClient() {
  const t = useTranslations("mcpServersPage");
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  const [deleteTarget, setDeleteTarget] = useState<McpServerRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-servers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServers(data.servers ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const patchServer = async (id: string, body: Record<string, unknown>) => {
    setActionError(null);
    const res = await fetch(`/api/mcp-servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    await fetchServers();
  };

  const toggleEnabled = async (row: McpServerRow) => {
    try {
      await patchServer(row.id, { enabled: !row.enabled });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const testConnection = async (row: McpServerRow) => {
    setTestingId(row.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/mcp-servers/${row.id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setProbes((prev) => ({ ...prev, [row.id]: data.probe }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/mcp-servers/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDeleteTarget(null);
      await fetchServers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        kind: form.kind,
        auth_type: form.auth_type,
        enabled: true,
      };
      if (form.kind === "http") body.url = form.url;
      if (form.kind === "stdio") {
        body.command = form.command;
        if (form.args.trim()) body.args = form.args.trim();
      }
      if (form.auth_secret) body.auth_secret = form.auth_secret;
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await fetchServers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setFormSaving(false);
    }
  };

  const endpointBase = (id: string) => `/api/mcp/servers/${id}`;

  const statusFor = (
    row: McpServerRow
  ): { label: string; variant: "success" | "error" | "warning" | "default" } => {
    if (!row.enabled) return { label: t("statusDisabled"), variant: "warning" };
    const probe = probes[row.id];
    if (!probe) return { label: t("statusIdle"), variant: "default" };
    if (!probe.ready) return { label: t("statusError"), variant: "error" };
    return { label: t("statusReady"), variant: "success" };
  };

  const toolsLabel = (row: McpServerRow): string => {
    const probe = probes[row.id];
    if (row.kind === "builtin") {
      return probe?.domain
        ? t("builtinDomain", { domain: probe.domain })
        : t("builtinDomain", { domain: "all" });
    }
    if (!probe) return "";
    return t("toolsCount", { count: probe.tools });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
            style={{ background: "var(--color-bg-tertiary)" }}
          >
            <span
              aria-hidden="true"
              className="material-symbols-rounded text-xl"
              style={{ color: "var(--color-primary)" }}
            >
              hub
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
              {t("title")}
            </h2>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              {t("subtitle")}
            </p>
          </div>
          <Button onClick={() => setFormOpen((open) => !open)} variant="primary" size="sm">
            {formOpen ? t("formCancel") : t("registerButton")}
          </Button>
        </div>
      </Card>

      {formOpen && (
        <Card className="p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--color-text)" }}>
            {t("formTitle")}
          </h3>
          <form onSubmit={submitForm} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                {t("formName")}
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. local code search"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                {t("formKind")}
              </label>
              <Select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as McpServerRow["kind"] })}
                options={[
                  { value: "http", label: "HTTP" },
                  { value: "stdio", label: "stdio" },
                  { value: "builtin", label: "builtin" },
                ]}
              />
            </div>
            {form.kind === "http" && (
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                  {t("formUrl")}
                </label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://host:port/mcp"
                  required
                />
              </div>
            )}
            {form.kind === "stdio" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-xs font-medium"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {t("formCommand")}
                  </label>
                  <Input
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder="/usr/bin/mcp-server"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-xs font-medium"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {t("formArgs")}
                  </label>
                  <Input
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                    placeholder="--config /etc/mcp.json"
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                {t("formAuthType")}
              </label>
              <Select
                value={form.auth_type}
                onChange={(e) => setForm({ ...form, auth_type: e.target.value })}
                options={[
                  { value: "none", label: "None" },
                  { value: "bearer", label: "Bearer token" },
                  { value: "header", label: "Custom header" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                {t("formAuthSecret")}
              </label>
              <Input
                type="password"
                value={form.auth_secret}
                onChange={(e) => setForm({ ...form, auth_secret: e.target.value })}
                placeholder={form.auth_type === "none" ? "—" : "secret"}
                disabled={form.auth_type === "none"}
              />
            </div>
            {formError && (
              <p
                className="text-xs md:col-span-2"
                style={{ color: "var(--color-danger, #ef4444)" }}
              >
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                {t("formCancel")}
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={formSaving}>
                {formSaving ? t("testing") : t("formSubmit")}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-6">
        {loading ? (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {t("loading")}
          </p>
        ) : loadError ? (
          <p className="text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
            {t("loadError")}: {loadError}
          </p>
        ) : servers.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {t("empty")}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {servers.map((row) => {
              const status = statusFor(row);
              const probe = probes[row.id];
              const tools = toolsLabel(row);
              return (
                <div
                  key={row.id}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-sm font-semibold"
                        style={{ color: "var(--color-text)" }}
                      >
                        {row.name}
                      </span>
                      <Badge variant="info" size="sm">
                        {row.kind}
                      </Badge>
                      {row.system && (
                        <Badge variant="default" size="sm">
                          {t("systemBadge")}
                        </Badge>
                      )}
                    </div>
                    <p
                      className="mt-1 font-mono text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {row.id}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        className="font-mono text-[11px]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {endpointBase(row.id)}/stream
                      </span>
                      <span
                        className="font-mono text-[11px]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {endpointBase(row.id)}/sse
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant={status.variant} size="sm">
                        {status.label}
                      </Badge>
                      {tools && (
                        <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                          {tools}
                        </span>
                      )}
                      {probe?.error && (
                        <span
                          className="max-w-full truncate text-[11px]"
                          style={{ color: "var(--color-danger, #ef4444)" }}
                          title={probe.error}
                        >
                          {probe.error}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={testingId === row.id}
                      onClick={() => testConnection(row)}
                    >
                      {testingId === row.id ? t("testing") : t("test")}
                    </Button>
                    {!row.system && (
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(row)}>
                        {t("delete")}
                      </Button>
                    )}
                    <Toggle checked={row.enabled} onChange={() => toggleEnabled(row)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {actionError && (
          <p className="mt-4 text-xs" style={{ color: "var(--color-danger, #ef4444)" }}>
            {actionError}
          </p>
        )}
      </Card>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        title={t("delete")}
        message={t("confirmDelete", { name: deleteTarget?.name ?? "" })}
        confirmText={t("delete")}
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
