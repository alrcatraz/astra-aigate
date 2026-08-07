"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, Button, CardSkeleton } from "@/shared/components";
import { useDisplayBaseUrl } from "@/shared/hooks";

interface ServiceEntry {
  id: string;
  name: string;
  type: string;
  url: string;
  health_endpoint?: string | null;
  enabled: number;
  system: number;
  proxied: boolean;
  last_status: "up" | "down" | "unknown";
}

const STATUS_STYLE: Record<string, string> = {
  up: "bg-green-500/15 text-green-600 dark:text-green-400",
  down: "bg-red-500/15 text-red-600 dark:text-red-400",
  unknown: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
};

export default function EndpointServicesTab() {
  const t = useTranslations("endpoint");
  const baseUrl = useDisplayBaseUrl();
  const [services, setServices] = useState<ServiceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/services")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => setServices(Array.isArray(data) ? data : (data.services ?? [])))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <Card className="p-4 text-red-500">
        {t("servicesLoadError")}: {error}
      </Card>
    );
  }
  if (!services) return <CardSkeleton />;

  const total = services.length;
  const enabledCount = services.filter((s) => s.enabled).length;
  const upCount = services.filter((s) => s.enabled && s.last_status === "up").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-2xl font-semibold">{total}</div>
          <div className="text-sm text-text-muted">{t("servicesTotal")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-semibold">{enabledCount}</div>
          <div className="text-sm text-text-muted">{t("servicesEnabled")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-semibold">{upCount}</div>
          <div className="text-sm text-text-muted">{t("servicesUp")}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="pb-2">{t("servicesName")}</th>
                <th className="pb-2">{t("servicesUrl")}</th>
                <th className="pb-2">{t("servicesType")}</th>
                <th className="pb-2">{t("servicesStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="py-2 font-medium">
                    {s.name}
                    {s.system ? (
                      <span className="ml-1 text-xs text-text-muted">· system</span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                      {s.proxied ? `${baseUrl}${s.url}` : s.url}
                    </code>
                    {s.proxied ? (
                      <span className="ml-1.5 rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                        {t("servicesProxied")}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 text-text-muted">{s.type}</td>
                  <td className="py-2">
                    {s.enabled ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.last_status] ?? STATUS_STYLE.unknown}`}
                      >
                        {s.last_status}
                      </span>
                    ) : (
                      <span className="rounded-full bg-neutral-500/15 px-2 py-0.5 text-xs font-medium text-text-muted">
                        {t("servicesDisabled")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex gap-2">
          <Link href="/dashboard/services">
            <Button variant="secondary">{t("servicesManage")}</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
