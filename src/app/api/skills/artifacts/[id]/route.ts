import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { skillRegistry } from "@/lib/skills/registry";
import { getSkillSource } from "@/lib/db/skillSources";
import { buildAdapterFromInstance, getSourceAdapter } from "@/lib/skills/adapters";
import { isOmnirouteBuiltinId } from "@/lib/skills/adapters/omnirouteBuiltinAdapter";
import { SkillArtifactService, ARTIFACT_FORMATS } from "@/lib/skills/artifactService";

const artifactService = new SkillArtifactService();

/**
 * GET /api/skills/artifacts/:id?format=agent-plugin|tarball
 *
 * AI Gate 产物产出：把已装 skill 打包成标准产物下发。AI Gate 不落任何 Agent 目录，
 * 只产出字节；消费方（智能体）拉取后自行规范化安装。
 *
 * 完整内容优先从源 adapter fetch（含 references/scripts），fallback 到 DB 的 handler
 * （即 SKILL.md 全文）。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") || "agent-plugin") as
      (typeof ARTIFACT_FORMATS)[number] | string;
    if (!ARTIFACT_FORMATS.includes(format as (typeof ARTIFACT_FORMATS)[number])) {
      return NextResponse.json(
        { error: `Unsupported format: ${format}. Use ${ARTIFACT_FORMATS.join(" | ")}` },
        { status: 400 }
      );
    }

    await skillRegistry.loadFromDatabase();
    const skill = skillRegistry.getSkill(id);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    // 组装 SkillContent：从源 adapter fetch 完整内容（references/scripts），fallback handler
    let content: {
      name: string;
      version: string;
      skillMd: string;
      references?: Record<string, string>;
      scripts?: Record<string, string>;
    } = {
      name: skill.name,
      version: skill.version || "1.0.0",
      skillMd: skill.handler || "",
      references: {},
      scripts: {},
    };

    try {
      const kind = (skill.sourceKind || skill.sourceProvider || "local") as Parameters<
        typeof getSourceAdapter
      >[0];
      let adapter = null;
      if (skill.sourceRef && !isOmnirouteBuiltinId(skill.sourceRef)) {
        const instance = await getSkillSource(skill.sourceRef);
        if (instance) adapter = buildAdapterFromInstance(instance);
      }
      if (!adapter) adapter = getSourceAdapter(kind);
      const meta = {
        name: skill.name,
        version: skill.version,
        description: skill.description,
        externalId: skill.externalId || skill.id,
        ref: skill.sourceRef,
      };
      if (adapter && meta.externalId) {
        const fetched = await adapter.fetch(meta as never).catch(() => null);
        if (fetched) {
          content = {
            name: fetched.name,
            version: fetched.version,
            skillMd: fetched.skillMd,
            references: fetched.references,
            scripts: fetched.scripts,
          };
        }
      }
    } catch {
      /* fallback 到 DB handler 已足够 */
    }

    const result = await artifactService.pack(
      {
        name: skill.name,
        version: skill.version,
        description: skill.description,
        externalId: skill.externalId || skill.id,
        ref: skill.sourceRef,
        tags: skill.tags,
        artifact: skill.artifact,
      },
      content,
      format as (typeof ARTIFACT_FORMATS)[number]
    );

    // Buffer → Uint8Array（NextResponse BodyInit 需 binary）
    return new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type":
          format === "agent-plugin" ? "application/x-agent-plugin" : "application/x-tar",
        "Content-Disposition": `attachment; filename="${result.skill.name}.${format}.bundle"`,
        "X-Artifact-Format": result.format,
        "X-Artifact-Version": result.version,
        "X-Artifact-Sha256": result.sha256,
      },
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
