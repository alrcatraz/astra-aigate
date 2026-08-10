/**
 * frontmatter.ts — SKILL.md frontmatter 解析（各源 adapter 共享）
 *
 * 解析 SKILL.md 顶部的 YAML frontmatter（name / description / version）。
 * 最小解析（不引入 yaml 依赖）：逐行匹配 `key: value`，支持 `>` 折叠标量的
 * 首行。够用的最小集——name/description 是 Agent Skills 必需的。
 */
import type { SkillMeta } from "../sourceKind";

/** 从 SKILL.md 提取 frontmatter 的 name/description/version。 */
export function parseFrontmatter(skillMd: string): Partial<SkillMeta> {
  const m = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return {
    name: out.name || undefined,
    description: out.description || undefined,
    version: out.version || undefined,
  };
}
