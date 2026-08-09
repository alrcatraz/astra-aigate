"use client";

// Phase 1g extraction — Issue #3501
// Renders a playground section on the individual provider page.
// Shows ServiceKindTabs if the provider declares multiple kinds; falls back to
// a single-kind panel or the LlmChatCard for standard LLM providers.

import { useState } from "react";
import { LlmChatCard } from "@/app/(dashboard)/dashboard/media-providers/components/LlmChatCard";
import { ServiceKindTabs } from "@/app/(dashboard)/dashboard/media-providers/components/ServiceKindTabs";
import { EmbeddingExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/EmbeddingExampleCard";
import { ImageExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/ImageExampleCard";
import { TtsExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/TtsExampleCard";
import { SttExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/SttExampleCard";
import { WebSearchExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/WebSearchExampleCard";
import { WebFetchExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/WebFetchExampleCard";
import { VideoExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/VideoExampleCard";
import { MusicExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/MusicExampleCard";
import { OcrExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/OcrExampleCard";
import { ModerationExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/ModerationExampleCard";
import { RerankExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/RerankExampleCard";
import { AudioTranslationExampleCard } from "@/app/(dashboard)/dashboard/media-providers/components/AudioTranslationExampleCard";
import type { ServiceKind } from "@/shared/constants/providers";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderServiceKinds } from "@/lib/providers/serviceKindIndex";

export const MEDIA_SERVICE_KINDS: ServiceKind[] = [
  "embedding",
  "image",
  "tts",
  "stt",
  "webSearch",
  "webFetch",
  "video",
  "music",
];

export function renderKindPanel(kind: ServiceKind, providerId: string): JSX.Element | null {
  switch (kind) {
    case "llm":
      return <LlmChatCard providerId={providerId} />;
    case "embedding":
      return <EmbeddingExampleCard providerId={providerId} />;
    case "image":
      return <ImageExampleCard providerId={providerId} />;
    case "tts":
      return <TtsExampleCard providerId={providerId} />;
    case "stt":
      return <SttExampleCard providerId={providerId} />;
    case "webSearch":
      return <WebSearchExampleCard providerId={providerId} />;
    case "webFetch":
      return <WebFetchExampleCard providerId={providerId} />;
    case "video":
      return <VideoExampleCard providerId={providerId} />;
    case "music":
      return <MusicExampleCard providerId={providerId} />;
    case "ocr":
      return <OcrExampleCard providerId={providerId} />;
    case "moderation":
      return <ModerationExampleCard providerId={providerId} />;
    case "rerank":
      return <RerankExampleCard providerId={providerId} />;
    case "audioTranslation":
      return <AudioTranslationExampleCard providerId={providerId} />;
    default:
      return null;
  }
}

export default function ProviderPlaygroundPanel({ providerId }: { providerId: string }) {
  // Resolve serviceKinds from the shared helper (declared on the provider
  // unioned with the registry-derived media kinds) so this panel stays in
  // lockstep with /dashboard/media-providers — a provider that serves e.g.
  // image/embedding in a media registry now shows those tabs here too.
  const providerEntry = AI_PROVIDERS[providerId as keyof typeof AI_PROVIDERS] as
    (Record<string, unknown> & { serviceKinds?: string[] }) | undefined;

  const resolvedKinds: readonly string[] = getProviderServiceKinds(
    providerId,
    providerEntry?.serviceKinds
  );

  const ALL_VALID_KINDS = [
    "llm",
    "embedding",
    "image",
    "imageToText",
    "tts",
    "stt",
    "webSearch",
    "webFetch",
    "video",
    "music",
    "ocr",
    "moderation",
    "rerank",
    "audioTranslation",
  ] as const;

  const kinds: ServiceKind[] =
    resolvedKinds.length > 0
      ? resolvedKinds.filter((k): k is ServiceKind =>
          (ALL_VALID_KINDS as readonly string[]).includes(k)
        )
      : ["llm"];

  // Filter out kinds that have no playground implementation yet
  const playgroundableKinds = kinds.filter((k) => k !== "imageToText");

  // useState must be called unconditionally (Rules of Hooks)
  const [activeKind, setActiveKind] = useState<ServiceKind>(playgroundableKinds[0] ?? "llm");

  if (playgroundableKinds.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Playground</h2>
      <ServiceKindTabs
        kinds={playgroundableKinds}
        activeKind={activeKind}
        onSelect={setActiveKind}
      />
      {renderKindPanel(activeKind, providerId)}
    </div>
  );
}
