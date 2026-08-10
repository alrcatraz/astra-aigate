import { NextResponse } from "next/server";
import { z } from "zod";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { skillRegistry } from "@/lib/skills/registry";
import { getSkillSource, touchSkillSourceSync } from "@/lib/db/skillSources";
import { buildAdapterFromInstance, getSourceAdapter } from "@/lib/skills/adapters";
import { isOmnirouteBuiltinId } from "@/lib/skills/adapters/omnirouteBuiltinAdapter";

const installSchema = z.object({
  name: z.string().min(1).max(64),
  version: z.string().default("1.0.0"),
  description: z.string().optional(),
  externalId: z.string().min(1),
});

/** POST /api/skills/sources/:id/install — 从源安装一个 skill 到 AI Gate。
 *  内置源（omniroute-builtin）为固定单实例（不在 skill_sources 表），
 *  直接从注册表取 adapter（与 discover route 对称）。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManagementAuth(request);
  if (auth) return auth;
  try {
    const { id } = await params;

    // 解析源身份：内置源走注册表；否则查 skill_sources 表
    let adapter;
    let sourceKind: string;
    let sourceRef: string;
    let sourceName: string;
    let sourceUrl: string | undefined;
    let isBuiltin = false;

    if (isOmnirouteBuiltinId(id)) {
      adapter = getSourceAdapter("omniroute-builtin");
      if (!adapter) {
        return NextResponse.json(
          { error: "Built-in source adapter not available" },
          { status: 501 }
        );
      }
      isBuiltin = true;
      sourceKind = "omniroute-builtin";
      sourceRef = id;
      sourceName = "OmniRoute Built-in";
      sourceUrl = undefined; // 内置源无外部 repo
    } else {
      const instance = await getSkillSource(id);
      if (!instance) {
        return NextResponse.json({ error: "Source not found" }, { status: 404 });
      }
      if (!instance.enabled) {
        return NextResponse.json({ error: "Source is disabled" }, { status: 409 });
      }
      adapter = buildAdapterFromInstance(instance);
      if (!adapter) {
        return NextResponse.json(
          { error: `No adapter for source kind: ${instance.kind}` },
          { status: 501 }
        );
      }
      sourceKind = instance.kind;
      sourceRef = instance.id;
      sourceName = instance.name;
      sourceUrl = instance.url;
    }

    const raw = await request.json().catch(() => null);
    const validation = validateBody(installSchema, raw ?? {});
    if (isValidationFailure(validation)) {
      return NextResponse.json(validation.error, { status: 400 });
    }
    const d = validation.data;

    // 先 discover 定位该 skill 的完整 meta（需要 metadata 才能 fetch）
    const metas = await adapter.discover();
    const meta = metas.find((m) => m.externalId === d.externalId || m.name === d.name);
    if (!meta) {
      return NextResponse.json({ error: `Skill "${d.name}" not found in source` }, { status: 404 });
    }

    const content = await adapter.fetch(meta);
    const skill = await skillRegistry.register({
      name: d.name,
      version: d.version,
      description: d.description || meta.description || "",
      schema: { input: { content: "string" }, output: { result: "string" } },
      handler: `// Installed from ${sourceName} (${sourceKind})\n// SourceRef: ${meta.externalId}\n// SKILL.md content:\n${content.skillMd}`,
      apiKeyId: sourceKind,
      enabled: true,
      mode: "auto",
      sourceKind,
      sourceRef,
      sourceUrl,
      externalId: meta.externalId,
      artifact: "agentskill",
      enabledTargets: undefined,
      tags: ["source:" + sourceKind],
      installCount: 1,
    });

    // 内置源不在 skill_sources 表，无 last_sync 可触碰
    if (!isBuiltin) {
      await touchSkillSourceSync(id);
    }
    return NextResponse.json({ success: true, id: skill.id, sourceId: id });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
