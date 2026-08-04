"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [oidcEnabled, setOidcEnabled] = useState<boolean | null>(null);
  const [nodeVersion, setNodeVersion] = useState<string | null>(null);
  const [nodeCompatible, setNodeCompatible] = useState(true);
  const [pageReady, setPageReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const raf = requestAnimationFrame(() => {});
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/settings/require-login`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.nodeVersion) setNodeVersion(data.nodeVersion);
          if (data.nodeCompatible === false) setNodeCompatible(false);
          if (
            data.requireLogin === false ||
            (data.authenticated === true && data.setupComplete === true)
          ) {
            router.push("/dashboard");
            router.refresh();
            return;
          }
          setHasPassword(data.hasPassword ?? false);
          setSetupComplete(data.setupComplete ?? false);
          setOidcEnabled(data.oidcEnabled ?? false);
        }
      } finally {
        setPageReady(true);
      }
    }
    checkAuth();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.needsSetup) {
        router.push("/dashboard/onboarding");
        return;
      }
      if (!res.ok) {
        setError(t("loginError") || "Invalid password");
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  if (!pageReady) {
    return (
      <div className="min-h-screen bg-[#f0f0f3] flex items-center justify-center">
        <div className="flex items-center gap-2 text-[#60646c]">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm">{t("loading")}</span>
        </div>
      </div>
    );
  }

  if (!setupComplete) {
    return (
      <div className="min-h-screen bg-[#f0f0f3] flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-[#e0e1e6] p-8 w-full max-w-md text-center">
          <h1 className="text-2xl font-semibold text-[#000000] tracking-tight mb-2">
            {t("welcome")}
          </h1>
          <p className="text-[#60646c] text-sm mb-8 leading-relaxed">{t("configureInstance")}</p>
          <button
            onClick={() => router.push("/dashboard/onboarding")}
            className="w-full bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] transition-colors"
          >
            {t("startOnboarding")}
          </button>
          <p className="mt-8 text-xs text-[#b0b4ba]">astra-aigate — {t("unifiedProxy")}</p>
        </div>
      </div>
    );
  }

  if (!hasPassword && setupComplete) {
    return (
      <div className="min-h-screen bg-[#f0f0f3] flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-[#e0e1e6] p-8 w-full max-w-md">
          <h1 className="text-2xl font-semibold text-[#000000] tracking-tight mb-2">
            {t("welcome")}
          </h1>
          <p className="text-[#60646c] text-sm mb-8 leading-relaxed">{t("setPassword")}</p>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="block text-[#60646c] text-xs font-medium mb-1.5">
                {t("password")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                className="w-full h-10 px-3 rounded-lg border border-[#e0e1e6] bg-white text-sm text-[#000000] placeholder:text-[#b0b4ba] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
              />
            </div>
            {error && (
              <div className="bg-red-50 text-[#dc2626] text-xs rounded-lg px-3 py-2">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? t("settingUp") || "Setting up..."
                : oidcEnabled
                  ? t("continueWithSSO")
                  : t("setPassword")}
            </button>
          </form>
          <p className="mt-6 text-xs text-[#b0b4ba] text-center">
            astra-aigate — {t("unifiedProxy")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f0f3] flex items-center justify-center p-6">
      <div className="bg-white rounded-xl border border-[#e0e1e6] p-8 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-[#000000] tracking-tight mb-2">{t("signIn")}</h1>
        <p className="text-[#60646c] text-sm mb-8 leading-relaxed">{t("signInDescription")}</p>

        {!nodeCompatible && nodeVersion && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3 mb-6">
            <p className="text-[#dc2626] text-sm font-medium">{t("nodeIncompatibleTitle")}</p>
            <p className="text-[#dc2626] text-xs mt-1">
              {t("nodeIncompatibleText")} (v{nodeVersion})
            </p>
          </div>
        )}

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="block text-[#60646c] text-xs font-medium mb-1.5">
              {t("password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              className="w-full h-10 px-3 rounded-lg border border-[#e0e1e6] bg-white text-sm text-[#000000] placeholder:text-[#b0b4ba] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
            />
          </div>
          {error && (
            <div className="bg-red-50 text-[#dc2626] text-xs rounded-lg px-3 py-2">{error}</div>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                {t("signingIn")}
              </span>
            ) : (
              t("signIn")
            )}
          </button>
        </form>
        <p className="mt-6 text-xs text-[#b0b4ba] text-center">
          astra-aigate — {t("unifiedProxy")}
        </p>
      </div>
    </div>
  );
}
