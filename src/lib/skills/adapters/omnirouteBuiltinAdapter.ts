/**
 * omnirouteBuiltinAdapter.ts — OmniRoute 自带内置 skill 源 (Phase 4 M3)
 *
 * 把 AI Gate 自带的 `skills/` 目录内置 skill（catalog — 46 个 cli 与 api
 * 类 skill，走 catalog.ts 从本地文件系统读）包装为 `omniroute-builtin` 源。
 *
 * 特性（决策 6）：预置、只读、锁死 —— 内置 skill 不可被用户误删/误改，升级随
 * OmniRoute 版本。与用户登记/安装的主体 skill 分桶。
 */
import { fetchSkillMarkdown, getCatalog } from "../../agentSkills/catalog";
import type { SkillContent, SkillMeta, SkillSourceAdapter } from "../sourceKind";

/** OmniRoute 内置源的单例 id。 */
export const OMNIROUTE_BUILTIN_ID = "omniroute::builtin";

export class OmnirouteBuiltinAdapter implements SkillSourceAdapter {
  readonly kind = "omniroute-builtin" as const;
  readonly id = OMNIROUTE_BUILTIN_ID;
  readonly displayName = "OmniRoute 内置技能";
  readonly writable = false;

  async discover(): Promise<SkillMeta[]> {
    const catalog = getCatalog();
    return catalog.map((skill) => ({
      name: skill.name || skill.id,
      description: skill.description || "",
      externalId: `builtin::${skill.id}`,
      ref: `skills/${skill.id}/SKILL.md`,
      tags: ["omniroute-builtin", skill.category || "builtin"],
      artifact: "agentskill" as const,
    }));
  }

  async fetch(meta: SkillMeta): Promise<SkillContent> {
    const id = meta.externalId.split("::").pop()!;
    const md = await fetchSkillMarkdown(id);
    const skillMd = `---\nname: ${md.frontmatter.name}\ndescription: ${md.frontmatter.description}\n---\n${md.body}`;
    return { name: meta.name, version: "1.0.0", skillMd };
  }
}

/** 只读锁：内置源不可被 delete/disable 等破坏性操作。由调用方（route）校验。 */
export function isOmnirouteBuiltinId(id: string): boolean {
  return id === OMNIROUTE_BUILTIN_ID;
}
