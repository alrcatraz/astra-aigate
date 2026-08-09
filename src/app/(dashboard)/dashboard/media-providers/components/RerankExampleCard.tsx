"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useApiKey } from "../../providers/hooks/useApiKey";
import { useProviderModels } from "../../providers/hooks/useProviderModels";
import { buildCurl } from "../../providers/utils/buildCurl";
import { PlaygroundCard } from "./PlaygroundCard";

interface Props {
  providerId: string;
}

const ENDPOINT_PATH = "/api/v1/rerank";

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const err = d.error as Record<string, unknown> | undefined;
  if (err?.message) return String(err.message);
  if (typeof d.message === "string") return d.message;
  return null;
}

export function RerankExampleCard({ providerId }: Props) {
  const t = useTranslations("miniPlayground");
  const { apiKey } = useApiKey();
  const { models } = useProviderModels(providerId);

  const firstModel = models[0]?.id ?? "";
  const [model, setModel] = useState<string>("");
  const [query, setQuery] = useState<string>("What is the capital of France?");
  const [documents, setDocuments] = useState<string>(
    "Paris is the capital of France\nBerlin is the capital of Germany"
  );
  const [topN, setTopN] = useState<string>("3");
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<{ data: unknown; latencyMs: number } | undefined>();
  const [error, setError] = useState<string | null>(null);

  const effectiveModel = model || firstModel;

  const buildBody = () => ({
    model: effectiveModel,
    query,
    documents: documents
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    top_n: Number(topN) || 3,
    return_documents: true,
  });

  const curlSnippet = buildCurl({
    endpoint:
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:20128") +
      ENDPOINT_PATH,
    headers: {
      Authorization: `Bearer ${apiKey || "<your-api-key>"}`,
      "Content-Type": "application/json",
    },
    body: buildBody(),
  });

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(undefined);
    const t0 = performance.now();
    try {
      const res = await fetch(ENDPOINT_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "x-connection-id": providerId,
        },
        body: JSON.stringify(buildBody()),
      });
      const data: unknown = await res.json();
      const latencyMs = performance.now() - t0;
      const errMsg = extractError(data);
      if (!res.ok || errMsg) {
        setError(errMsg ?? `HTTP ${res.status}`);
      } else {
        setResult({ data, latencyMs });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("requestFailed"));
    } finally {
      setRunning(false);
    }
  };

  const modelOptions = models.length > 0 ? models : [{ id: "bge-reranker-v2-m3" }];

  return (
    <PlaygroundCard
      kindLabel={t("rerank")}
      apiEndpoint={ENDPOINT_PATH}
      onRun={handleRun}
      curlSnippet={curlSnippet}
      running={running}
      result={result}
      error={error}
    >
      <div>
        <label className="block text-xs text-text-muted mb-1">{t("model")}</label>
        <select
          value={model || firstModel}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-md border border-border bg-bg-subtle text-sm px-2 py-1.5 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">{t("query")}</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-border bg-bg-subtle text-sm px-2 py-1.5 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">{t("documents")}</label>
        <textarea
          value={documents}
          onChange={(e) => setDocuments(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-bg-subtle text-sm px-2 py-1.5 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">{t("topN")}</label>
        <input
          type="number"
          value={topN}
          min={1}
          onChange={(e) => setTopN(e.target.value)}
          className="w-24 rounded-md border border-border bg-bg-subtle text-sm px-2 py-1.5 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    </PlaygroundCard>
  );
}
