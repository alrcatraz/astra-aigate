"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Button, Input, Select, Toggle, Badge } from "@/shared/components";
import { useDisplayBaseUrl } from "@/shared/hooks";

interface ServiceRow {
  id: string;
  name: string;
  type: "web" | "http";
  url: string;
  health_endpoint: string | null;
  enabled: boolean;
  system: boolean;
  source: string;
  proxied: boolean;
  upstream: string | null;
  required_scope: string | null;
  last_status: "up" | "down" | "unknown";
  last_checked_at: string | null;
}

interface ProbeResult {
  service_id: string;
  status: "up" | "down";
  latency_ms: number | null;
  error: string | null;
  checked_at: string;
}

const EMPTY_FORM = {
  name: "",
  type: "web" as "web" | "http",
  url: "",
  health_endpoint: "",
  proxied: false,
  upstream: "",
  required_scope: "",
};

export default function ServicesPageClient() {
  const t = useTranslations("servicesPage");
  const baseUrl = useDisplayBaseUrl();
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch("/api/services");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServices(data.services ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const patchService = async (id: string, body: Record<string, unknown>) => {
    setActionError(null);
    const res = await fetch(`/api/services/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    await fetchServices();
  };

  const toggleEnabled = async (row: ServiceRow) => {
    try {
      await patchService(row.id, { enabled: !row.enabled });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const probe = async (row: ServiceRow) => {
    setProbingId(row.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/services/${row.id}/probe`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setProbes((prev) => ({ ...prev, [row.id]: data }));
      await fetchServices();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbingId(null);
    }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          url: form.url,
          health_endpoint: form.health_endpoint || null,
          enabled: true,
          proxied: form.proxied,
          upstream: form.upstream || null,
          required_scope: form.required_scope || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await fetchServices();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setFormSaving(false);
    }
  };

  const confirmDelete = async (row: ServiceRow) => {
    if (!window.confirm(`${t("deleteConfirmMessage")} ${row.id}`)) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/services/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await fetchServices();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const statusBadge = (status: ServiceRow["last_status"]) => {
    const variant = status === "up" ? "success" : status === "down" ? "error" : "default";
    const label =
      status === "up" ? t("statusUp") : status === "down" ? t("statusDown") : t("statusUnknown");
    return <Badge variant={variant}>{label}</Badge>;
  };

  if (loading) {
    return <p className="text-sm text-text-muted">{t("loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-text-muted mt-1">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setFormOpen((v) => !v)}>
          {formOpen ? t("cancel") : t("addService")}
        </Button>
      </div>

      {loadError && (
        <p className="text-sm text-red-500">
          {t("loadError")}: {loadError}
        </p>
      )}
      {actionError && <p className="text-sm text-red-500">{actionError}</p>}

      {formOpen && (
        <Card className="p-5">
          <h2 className="text-base font-semibold mb-4">{t("registerService")}</h2>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">{t("name")}</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("namePlaceholder")}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">{t("type")}</label>
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as "web" | "http" })}
                >
                  <option value="web">{t("typeWeb")}</option>
                  <option value="http">{t("typeHttp")}</option>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">{t("url")}</label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder={t("urlPlaceholder")}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">{t("healthEndpoint")}</label>
                <Input
                  value={form.health_endpoint}
                  onChange={(e) => setForm({ ...form, health_endpoint: e.target.value })}
                  placeholder={t("healthPlaceholder")}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">{t("upstream")}</label>
                <Input
                  value={form.upstream}
                  onChange={(e) => setForm({ ...form, upstream: e.target.value })}
                  placeholder={t("upstreamPlaceholder")}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">{t("requiredScope")}</label>
                <Input
                  value={form.required_scope}
                  onChange={(e) => setForm({ ...form, required_scope: e.target.value })}
                  placeholder={t("requiredScopePlaceholder")}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={form.proxied}
                onChange={() => setForm({ ...form, proxied: !form.proxied })}
              />
              <span className="text-sm">{t("proxied")}</span>
            </div>
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex gap-3">
              <Button type="submit" disabled={formSaving}>
                {formSaving ? t("saving") : t("save")}
              </Button>
              <Button variant="secondary" onClick={() => setFormOpen(false)}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {services.length === 0 && !loadError && (
        <p className="text-sm text-text-muted">{t("noServices")}</p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {services.map((service) => (
          <Card key={service.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{service.id}</span>
                  {service.system && <Badge variant="default">{t("preset")}</Badge>}
                </div>
                <p className="text-sm mt-0.5 truncate">
                  {service.proxied ? `${baseUrl}${service.url}` : service.url}
                  {service.proxied && (
                    <span className="ml-1.5 rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                      {t("viaGateway")}
                    </span>
                  )}
                </p>
                {service.health_endpoint && (
                  <p className="text-xs text-text-muted mt-0.5">
                    {t("healthEndpoint")}: {service.health_endpoint}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                {statusBadge(service.last_status)}
                {service.last_checked_at && (
                  <span className="text-[11px] text-text-muted">
                    {t("lastChecked")} {service.last_checked_at.slice(0, 19).replace("T", " ")}
                  </span>
                )}
                {probes[service.id] && (
                  <span className="text-[11px] text-text-muted">
                    {probes[service.id].latency_ms !== null
                      ? `${probes[service.id].latency_ms} ms`
                      : (probes[service.id].error ?? "")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-black/5 dark:border-white/5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => probe(service)}
                disabled={probingId === service.id || !service.enabled}
              >
                {probingId === service.id ? t("probing") : t("probe")}
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{t("enabled")}</span>
                <Toggle checked={service.enabled} onChange={() => toggleEnabled(service)} />
              </div>
              <div className="flex-1" />
              {!service.system && (
                <Button size="sm" variant="danger" onClick={() => confirmDelete(service)}>
                  {t("deleteService")}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
