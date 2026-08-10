"use client";

import { useTranslations } from "next-intl";
import { OmniSourcesTab } from "../omni-skills/components/OmniSourcesTab";

/**
 * Skill Hub — standalone page for skill source registration, discovery and
 * artifact packaging (the multi-source skill aggregation feature). Kept as a
 * thin shell around OmniSourcesTab so the sources workflow lives in one
 * component regardless of whether it is opened via the sidebar entry or the
 * omni-skills tab.
 */
export default function SkillSourcesPage(): JSX.Element {
  const t = useTranslations("skills");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("skillHubTitle")}</h1>
        <p className="text-text-muted text-sm mt-1">{t("skillHubSubtitle")}</p>
      </div>
      <OmniSourcesTab onRefreshSkills={async () => undefined} />
    </div>
  );
}
