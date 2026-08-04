"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDisplayBaseUrl } from "@/shared/hooks";
import { TierTour } from "./steps/TierTour";

const STEP_IDS = ["welcome", "tiers", "security", "provider", "test", "done"];
const STEP_ICONS = ["waving_hand", "layers", "lock", "dns", "play_circle", "check_circle"];

const STEPS = STEP_IDS.map((id, i) => ({
  id,
  icon: STEP_ICONS[i],
  title: `onboarding.${id}Title`,
}));

const COMMON_PROVIDERS = [
  { id: "openai", name: "OpenAI", color: "#10A37F" },
  { id: "anthropic", name: "Anthropic", color: "#D97757" },
  { id: "google", name: "Google AI", color: "#4285F4" },
  { id: "openrouter", name: "OpenRouter", color: "#6B21A8" },
  { id: "groq", name: "Groq", color: "#F55036" },
  { id: "mistral", name: "Mistral", color: "#FF7000" },
];

// Progress bar
function ProgressDots({ current, total }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i <= current ? "bg-black w-6" : "bg-[#e0e1e6] w-1.5"
          }`}
        />
      ))}
    </div>
  );
}

export default function OnboardingWizard() {
  const router = useRouter();
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");
  const baseUrl = useDisplayBaseUrl();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const apiEndpoint = `${baseUrl}/api/v1`;

  // Security step state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [skipSecurity, setSkipSecurity] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  // Provider step state
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [providerUrl, setProviderUrl] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [providerName, setProviderName] = useState("");

  // Test step state
  const [testStatus, setTestStatus] = useState("idle"); // idle, testing, success, error
  const [testMessage, setTestMessage] = useState("");

  // Check if setup is already complete
  useEffect(() => {
    fetch("/api/settings/require-login")
      .then((r) => r.json())
      .then((data) => {
        // Bounce only configured instances. Fresh installs (bootstrap window,
        // no password yet) must be allowed through to run the wizard — the
        // old guard (requireLogin===true) looped login -> onboarding -> login.
        if (data.requireLogin === true && data.setupComplete === true) {
          router.replace("/login");
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [router]);

  const currentStep = STEPS[step] || STEPS[0];
  const isLastStep = step === STEPS.length - 1;

  // Error state (shared across steps)
  const [errorMessage, setErrorMessage] = useState("");

  // Normalise API error payloads to a displayable string. The authz pipeline
  // returns error objects ({ code, message }) — rendering those raw would
  // crash React with "Objects are not valid as a React child" (ISE).
  const errorText = (e: unknown): string => {
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const m = (e as { message?: unknown }).message;
      if (typeof m === "string") return m;
      return JSON.stringify(e);
    }
    return "Request failed";
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleSetPassword = async () => {
    if (skipSecurity) {
      // (#574) Explicitly disable requireLogin when skipping password setup
      try {
        await fetch("/api/settings/require-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requireLogin: false }),
        });
      } catch {}
      handleNext();
      return;
    }
    if (password !== confirmPassword) return;
    setErrorMessage("");
    try {
      const res = await fetch("/api/settings/require-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin: true, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setErrorMessage(errorText(data.error) || "Failed to set password");
        return;
      }
      handleNext();
    } catch {
      setErrorMessage("Network error");
    }
  };

  const handleAddProvider = async () => {
    if (!selectedProvider || !providerKey) return;
    setErrorMessage("");
    try {
      const data = {
        id: selectedProvider,
        name: providerName,
        baseUrl: providerUrl || undefined,
        apiKey: providerKey,
      };
      const res = await fetch("/api/v1/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        setErrorMessage(errorText(err.error) || "Failed to add provider");
        return;
      }
      handleNext();
    } catch {
      setErrorMessage("Network error");
    }
  };

  const handleTestProvider = async () => {
    setTestStatus("testing");
    setTestMessage(t("testingProvider"));
    try {
      const res = await fetch("/api/v1/health/models", { method: "GET" });
      if (res.ok) {
        setTestStatus("success");
        setTestMessage(t("testSuccess"));
      } else {
        setTestStatus("error");
        setTestMessage(t("testFailed"));
      }
    } catch {
      setTestStatus("error");
      setTestMessage("Network error");
    }
  };

  const handleDone = () => {
    router.push("/dashboard");
  };

  const handleFinish = () => {
    router.push("/dashboard");
  };

  if (loading) {
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

  return (
    <div className="min-h-screen bg-[#f0f0f3] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Progress dots */}
        <ProgressDots current={step} total={STEPS.length} />

        {/* Step label */}
        <p className="text-center text-xs font-medium text-[#b0b4ba] uppercase tracking-wider mb-1">
          {t(`${currentStep.id}Title`)}
        </p>

        {/* Card */}
        <div className="bg-white rounded-xl border border-[#e0e1e6] p-8">
          {/* Step Header */}
          <div className="text-center mb-6">
            <span className="material-symbols-outlined block text-4xl mb-3 text-[#000000]">
              {currentStep.icon}
            </span>
            <h2 className="text-xl font-semibold text-[#000000] tracking-tight">
              {t(`${currentStep.id}Title`)}
            </h2>
            {currentStep.id === "tiers" && (
              <p className="mt-2 text-sm text-[#60646c] max-w-md mx-auto leading-relaxed">
                {t("tier.subtitle")}
              </p>
            )}
          </div>

          {/* Welcome */}
          {currentStep.id === "welcome" && (
            <div className="text-center">
              <p className="text-sm text-[#60646c] mb-6">{t("welcomeDesc")}</p>
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { icon: "swap_horiz", label: t("multiProvider") },
                  { icon: "monitoring", label: t("usageTracking") },
                  { icon: "shield", label: t("apiKeyMgmt") },
                ].map((f) => (
                  <div key={f.icon} className="bg-[#f0f0f3] rounded-xl p-4 text-center">
                    <span className="material-symbols-outlined block text-2xl mb-2 text-[#000000]">
                      {f.icon}
                    </span>
                    <span className="text-xs text-[#60646c] leading-tight block">{f.label}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={handleNext}
                className="w-full bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] transition-colors"
              >
                {t("getStarted")}
              </button>
            </div>
          )}

          {/* Tiers */}
          {currentStep.id === "tiers" && (
            <div>
              <TierTour />
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleBack}
                  className="flex-1 border border-[#e0e1e6] text-[#60646c] rounded-full px-6 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  {tc("back")}
                </button>
                <button
                  onClick={handleNext}
                  className="flex-[2] bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] transition-colors"
                >
                  {t("continue")}
                </button>
              </div>
            </div>
          )}

          {/* Security */}
          {currentStep.id === "security" && (
            <div>
              <p className="text-sm text-[#60646c] mb-6 text-center">{t("securityDesc")}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSetPassword();
                }}
              >
                <div className="space-y-4 mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipSecurity}
                      onChange={(e) => setSkipSecurity(e.target.checked)}
                      className="rounded border-[#e0e1e6] text-[#000000] focus:ring-[#000000]"
                    />
                    <span className="text-sm text-[#60646c]">{t("skipSecurity")}</span>
                  </label>
                  {!skipSecurity && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-[#60646c] mb-1.5">
                          {t("setPassword")}
                        </label>
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyDown={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                          placeholder={t("passwordPlaceholder")}
                          className="w-full h-10 px-3 rounded-lg border border-[#e0e1e6] bg-white text-sm text-[#000000] placeholder:text-[#b0b4ba] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#60646c] mb-1.5">
                          {t("confirmPassword")}
                        </label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder={t("confirmPasswordPlaceholder")}
                          className="w-full h-10 px-3 rounded-lg border border-[#e0e1e6] bg-white text-sm text-[#000000] placeholder:text-[#b0b4ba] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
                        />
                      </div>
                      {password && confirmPassword && password !== confirmPassword && (
                        <div className="bg-red-50 text-[#dc2626] text-xs rounded-lg px-3 py-2">
                          {t("passwordsDoNotMatch")}
                        </div>
                      )}
                      {capsLockOn && (
                        <div className="bg-amber-50 text-[#f59e0b] text-xs rounded-lg px-3 py-2">
                          {t("capsLockOn")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex-1 border border-[#e0e1e6] text-[#60646c] rounded-full px-6 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    {tc("back")}
                  </button>
                  <button
                    type="submit"
                    disabled={
                      !skipSecurity &&
                      (!password || !confirmPassword || password !== confirmPassword)
                    }
                    className="flex-[2] bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {t("continue")}
                  </button>
                </div>
              </form>
              {errorMessage && (
                <div className="mt-4 bg-red-50 text-[#dc2626] text-xs rounded-lg px-3 py-2">
                  {errorMessage}
                </div>
              )}
            </div>
          )}

          {/* Provider */}
          {currentStep.id === "provider" && (
            <div>
              <p className="text-sm text-[#60646c] text-center mb-6">{t("providerDesc")}</p>
              <div className="grid grid-cols-3 gap-3 mb-6">
                {COMMON_PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProvider(p.id);
                      setProviderName(p.name);
                    }}
                    className={`rounded-xl border p-4 text-center transition-all ${
                      selectedProvider === p.id
                        ? "border-[#000000] bg-gray-50"
                        : "border-[#e0e1e6] hover:border-[#b0b4ba] hover:bg-gray-50"
                    }`}
                  >
                    <div
                      className="w-3 h-3 rounded-full mx-auto mb-2"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="text-xs font-medium text-[#60646c]">{p.name}</span>
                  </button>
                ))}
              </div>
              {selectedProvider && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[#60646c] mb-1.5">
                      {t("apiKey")}
                    </label>
                    <input
                      type="password"
                      value={providerKey}
                      onChange={(e) => setProviderKey(e.target.value)}
                      placeholder={t("apiKeyRequired")}
                      className="w-full h-10 px-3 rounded-lg border border-[#e0e1e6] bg-white text-sm text-[#000000] placeholder:text-[#b0b4ba] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#60646c] mb-1.5">
                      {t("apiUrl")}
                    </label>
                    <input
                      type="text"
                      value={providerUrl}
                      onChange={(e) => setProviderUrl(e.target.value)}
                      placeholder={t("customUrlOptional")}
                      className="w-full h-10 px-3 rounded-lg border border-[#e0e1e6] bg-white text-sm text-[#000000] placeholder:text-[#b0b4ba] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
                    />
                  </div>
                </div>
              )}
              {errorMessage && (
                <div className="mt-4 bg-red-50 text-[#dc2626] text-xs rounded-lg px-3 py-2">
                  {errorMessage}
                </div>
              )}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleBack}
                  className="flex-1 border border-[#e0e1e6] text-[#60646c] rounded-full px-6 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  {tc("back")}
                </button>
                <button
                  onClick={handleAddProvider}
                  disabled={!selectedProvider || !providerKey}
                  className="flex-[2] bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {t("addProvider")}
                </button>
              </div>
            </div>
          )}

          {/* Test */}
          {currentStep.id === "test" && (
            <div className="text-center">
              <p className="text-sm text-[#60646c] mb-6">{t("testDesc")}</p>
              {testStatus === "idle" && (
                <button
                  onClick={handleTestProvider}
                  className="w-full bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] transition-colors"
                >
                  {t("runTest")}
                </button>
              )}
              {testStatus === "testing" && (
                <div className="flex items-center justify-center gap-2 text-[#60646c]">
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
                  <span className="text-sm">{testMessage}</span>
                </div>
              )}
              {testStatus === "success" && (
                <div>
                  <span className="material-symbols-outlined text-4xl text-[#16a34a]">
                    check_circle
                  </span>
                  <p className="text-sm font-semibold text-[#16a34a] mt-2">{t("testSuccess")}</p>
                  {testMessage && testMessage !== t("testSuccess") && (
                    <p className="text-xs text-[#60646c] mt-1">{testMessage}</p>
                  )}
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={handleBack}
                      className="flex-1 border border-[#e0e1e6] text-[#60646c] rounded-full px-6 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      {tc("back")}
                    </button>
                    <button
                      onClick={handleNext}
                      className="flex-[2] bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] transition-colors"
                    >
                      {t("continue")}
                    </button>
                  </div>
                </div>
              )}
              {testStatus === "error" && (
                <div>
                  <span className="material-symbols-outlined text-4xl text-[#dc2626]">error</span>
                  <p className="text-sm font-semibold text-[#dc2626] mt-2">{t("testFailed")}</p>
                  {testMessage && testMessage !== t("testFailed") && (
                    <p className="text-xs text-[#60646c] mt-1">{testMessage}</p>
                  )}
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={handleBack}
                      className="flex-1 border border-[#e0e1e6] text-[#60646c] rounded-full px-6 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      {tc("back")}
                    </button>
                    <button
                      onClick={handleTestProvider}
                      className="flex-[2] bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] transition-colors"
                    >
                      {t("retry")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Done */}
          {currentStep.id === "done" && (
            <div className="text-center">
              <p className="text-sm text-[#60646c] mb-6">{t("doneDesc")}</p>
              <div className="bg-[#f0f0f3] rounded-xl p-4 mb-6 text-left">
                <p className="text-xs font-medium text-[#60646c] mb-1">{t("yourEndpoint")}</p>
                <code className="text-sm text-[#000000] break-all">{apiEndpoint}</code>
              </div>
              <button
                onClick={handleDone}
                className="w-full bg-[#000000] text-white rounded-full px-6 py-2.5 text-sm font-medium hover:bg-[#333333] transition-colors"
              >
                {t("launchDashboard")}
              </button>
            </div>
          )}
        </div>

        {/* Skip link */}
        <div className="text-center mt-4">
          <button
            onClick={handleFinish}
            className="text-xs text-[#b0b4ba] hover:text-[#60646c] transition-colors cursor-pointer bg-transparent border-none"
          >
            {t("skipWizard")}
          </button>
        </div>
      </div>
    </div>
  );
}
