import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { skillRegistry } from "@/lib/skills/registry";

/**
 * GET /api/skills/artifacts?source=<kind>
 *
 * AI Gate 产物目录：列出可被打包消费的 skill（含其源/版本信息）。
 * 这是「AI Gate 产出侧」可消费清单，供编排者/看护者选择打包。
 */
export async function GET(request?: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;
  try {
    await skillRegistry.loadFromDatabase();
    const url = new URL(request?.url || "http://localhost/api/skills/artifacts");
    const sourceFilter = url.searchParams.get("source")?.trim() || "";
    let skills = skillRegistry.list();
    if (sourceFilter) {
      skills = skills.filter((s) => (s.sourceKind || s.sourceProvider || "local") === sourceFilter);
    }
    return NextResponse.json({
      artifacts: skills.map((s) => ({
        id: s.id,
        name: s.name,
        version: s.version,
        description: s.description,
        sourceKind: s.sourceKind || s.sourceProvider || "local",
        sourceRef: s.sourceRef,
        externalId: s.externalId,
        artifact: s.artifact || "agentskill",
      })),
      total: skills.length,
      formats: ["agent-plugin", "tarball"],
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
