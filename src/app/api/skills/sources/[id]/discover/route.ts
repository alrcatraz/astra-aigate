import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getSkillSource } from "@/lib/db/skillSources";
import { buildAdapterFromInstance, getSourceAdapter } from "@/lib/skills/adapters";
import { isOmnirouteBuiltinId } from "@/lib/skills/adapters/omnirouteBuiltinAdapter";

/** GET /api/skills/sources/:id/discover — 发现源下的全部 skill 元数据。
 *  内置源（omniroute-builtin）为固定单实例（不在 skill_sources 表），
 *  直接从注册表取 adapter。 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManagementAuth(request);
  if (auth) return auth;
  try {
    const { id } = await params;

    // 内置源：直接查注册表（固定单实例）
    if (isOmnirouteBuiltinId(id)) {
      const adapter = getSourceAdapter("omniroute-builtin");
      if (!adapter) {
        return NextResponse.json(
          { error: "Built-in source adapter not available" },
          { status: 501 }
        );
      }
      const metas = await adapter.discover();
      return NextResponse.json({
        sourceId: id,
        kind: "omniroute-builtin",
        builtin: true,
        skills: metas,
      });
    }

    const instance = await getSkillSource(id);
    if (!instance) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    if (!instance.enabled) {
      return NextResponse.json({ error: "Source is disabled" }, { status: 409 });
    }
    const adapter = buildAdapterFromInstance(instance);
    if (!adapter) {
      return NextResponse.json(
        { error: `No adapter for source kind: ${instance.kind}` },
        { status: 501 }
      );
    }
    const metas = await adapter.discover();
    return NextResponse.json({ sourceId: id, kind: instance.kind, skills: metas });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
