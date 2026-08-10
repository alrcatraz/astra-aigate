import { NextResponse } from "next/server";
import { z } from "zod";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { createSkillSource, listSkillSources } from "@/lib/db/skillSources";

const createSourceSchema = z.object({
  kind: z.enum(["github-public", "gitea"]),
  name: z.string().min(1).max(128),
  url: z.string().min(1).max(1024),
  skillsPath: z.string().default("skills"),
  credentialRef: z.string().optional(),
  autoUpdate: z.boolean().default(false),
});

/** GET /api/skills/sources — 列出用户登记的 skill 源。 */
export async function GET(request?: Request) {
  const auth = await requireManagementAuth(request);
  if (auth) return auth;
  try {
    const sources = await listSkillSources();
    return NextResponse.json({ sources });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}

/** POST /api/skills/sources — 登记新的 skill 源（项目附属 GitHub/Gitea repo）。 */
export async function POST(request: Request) {
  const auth = await requireManagementAuth(request);
  if (auth) return auth;
  try {
    const raw = await request.json().catch(() => null);
    const validation = validateBody(createSourceSchema, raw ?? {});
    if (isValidationFailure(validation)) {
      return NextResponse.json(validation.error, { status: 400 });
    }
    const d = validation.data;
    const source = await createSkillSource({
      kind: d.kind,
      name: d.name,
      url: d.url,
      skillsPath: d.skillsPath,
      credentialRef: d.credentialRef,
      autoUpdate: d.autoUpdate,
    });
    return NextResponse.json({ success: true, id: source.id, source }, { status: 201 });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
