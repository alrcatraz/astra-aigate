import { NextResponse } from "next/server";
import { z } from "zod";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { deleteSkillSource, setSkillSourceEnabled } from "@/lib/db/skillSources";
import { isOmnirouteBuiltinId } from "@/lib/skills/adapters/omnirouteBuiltinAdapter";

const patchSchema = z.object({ enabled: z.boolean() });

/** PATCH /api/skills/sources/:id — 启用/禁用源。
 *  内置源（omniroute-builtin）只读锁死，禁止禁用。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManagementAuth(request);
  if (auth) return auth;
  try {
    const { id } = await params;
    // 内置源保护：不可禁用
    if (isOmnirouteBuiltinId(id)) {
      return NextResponse.json(
        { error: "Built-in source is read-only and cannot be disabled" },
        { status: 403 }
      );
    }
    const raw = await request.json().catch(() => null);
    const validation = validateBody(patchSchema, raw ?? {});
    if (isValidationFailure(validation)) {
      return NextResponse.json(validation.error, { status: 400 });
    }
    await setSkillSourceEnabled(id, validation.data.enabled);
    return NextResponse.json({ success: true, id, enabled: validation.data.enabled });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}

/** DELETE /api/skills/sources/:id — 删除登记的源实例。
 *  内置源（omniroute-builtin）只读锁死，禁止删除。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireManagementAuth(request);
  if (auth) return auth;
  try {
    const { id } = await params;
    if (isOmnirouteBuiltinId(id)) {
      return NextResponse.json(
        { error: "Built-in source is read-only and cannot be deleted" },
        { status: 403 }
      );
    }
    await deleteSkillSource(id);
    return NextResponse.json({ success: true, id });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
