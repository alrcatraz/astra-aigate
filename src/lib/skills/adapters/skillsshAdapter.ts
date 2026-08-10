/**
 * skillsshAdapter.ts — skills.sh 外部 hub 源适配器 (Phase 4 M0)
 *
 * 把现有 searchSkillsSh / fetchSkillMd 函数封装为统一的 SkillSourceAdapter。
 * 只读源（writable=false），无认证。discover() 对应 skills.sh 搜索，
 * fetch() 对应从 GitHub raw 拉取 SKILL.md。
 */
import type { SkillContent, SkillMeta, SkillSourceAdapter } from "../sourceKind";
import { SKILL_SOURCE_KINDS } from "../sourceKind";
import { fetchSkillMd, searchSkillsSh } from "../skillssh";

export const skillsshAdapter: SkillSourceAdapter = {
  kind: "skillssh",
  id: "skillssh",
  displayName: "skills.sh",
  writable: false,

  async discover(): Promise<SkillMeta[]> {
    // API 搜索需要 query/limit 参数；adapter 层提供空 query 拉取默认列表。
    const res = await searchSkillsSh("", 20);
    return res.skills.map((s) => ({
      name: s.name,
      version: undefined,
      description: undefined,
      externalId: s.skillId,
      ref: s.source, // owner/repo
      tags: [],
    }));
  },

  async fetch(skill: SkillMeta): Promise<SkillContent> {
    const source = skill.ref ?? "";
    const skillMd = await fetchSkillMd(source, skill.externalId);
    return {
      name: skill.name,
      version: skill.version ?? "1.0.0",
      skillMd,
      references: {},
      scripts: {},
    };
  },
};

/** 类型守卫：确认 skillssh 属受控源枚举。 */
export function isSkillsshKind(kind: unknown): boolean {
  return kind === SKILL_SOURCE_KINDS[0];
}
