/**
 * skillArtifactService.ts — Skill 产物服务（Phase 4 M2，★2026-08-09 重构）
 *
 * AI Gate **产出侧**：把登记的 skill 打包成中立、可复现、版本化的产物，供
 * 智能体（编排者 Hermes / 看护者）拉取、解析、规范化后安装到目标 Agent。
 *
 * 关键边界（设计修正）：AI Gate **不写任何外部 Agent 目录**。安装由消费方
 * （智能体）实现 —— 本服务只产出，不落地。产物格式：
 *   - `agent-plugin`：遵循 agent-plugins.org v1.0.0（plugin.json + skills/）
 *   - `tarball`     ：中立源码包（SKILL.md + references/ + scripts/ + 元数据）
 */
import { createHash } from "node:crypto";
import type { SkillContent, SkillMeta } from "./sourceKind";

/** Agent Plugins 规范 v1.0.0 的 plugin.json 必填 $schema。 */
export const AGENT_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/** 产物格式枚举。 */
export const ARTIFACT_FORMATS = ["agent-plugin", "tarball"] as const;
export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number];

/** 产物句柄——标识一个可消费的产物（含版本 + 哈希，供幂等安装）。 */
export interface ArtifactHandle {
  skill: SkillMeta;
  format: ArtifactFormat;
  version: string;
  sha256: string;
}

/** pack 的结果：句柄 + 产物字节（供 fetchArtifact / 测试 / 消费方直接摄取）。 */
export interface ArtifactResult extends ArtifactHandle {
  /** 生成时间戳。 */
  generatedAt: string;
  /** 产物字节（解码契约见 parseArtifact）。 */
  bytes: Buffer;
}

/** 消费契约（供智能体侧实现；AI Gate 只定义类型不实现写目录）。 */
export interface AgentInstallContract {
  /** 解析产物 → 目标 Agent 的原生 skill 元数据 / 内容。 */
  normalize(artifact: ArtifactHandle, targetAgent: string): Promise<SkillContent>;
  /** 安装到目标 Agent 工作目录（消费方实现）。 */
  install(meta: SkillContent, targetAgent: string): Promise<{ ok: boolean; path?: string }>;
  /** 更新目标 Agent 已装的 skill（消费方实现）。 */
  update(meta: SkillContent, targetAgent: string): Promise<{ ok: boolean }>;
  /** 从目标 Agent 移除 skill（消费方实现）。 */
  uninstall(targetAgent: string, skillName: string): Promise<{ ok: boolean }>;
}

/** 校验 plugin name 是否符合 Agent Plugins v1.0.0 约束。 */
export function isValidPluginName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 64 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name) &&
    !name.includes("--") &&
    !name.includes("..")
  );
}

/** 把任意 skill 名规范化成合法 plugin name（不合规时降级）。 */
export function normalizePluginName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return isValidPluginName(slug)
    ? slug
    : `skill-${createHash("sha1").update(name).digest("hex").slice(0, 12)}`;
}

/** 生成 Agent Plugins v1.0.0 的 plugin.json（仅 skills 组件；无 MCP）。 */
export function buildPluginManifest(skill: SkillMeta): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    $schema: AGENT_PLUGIN_SCHEMA,
    name: normalizePluginName(skill.name),
  };
  if (skill.version && skill.version !== "1.0.0") manifest.version = skill.version;
  if (skill.description) manifest.description = skill.description;
  if (skill.tags?.length) manifest.keywords = skill.tags.slice(0, 12);
  return manifest;
}

/**
 * SkillArtifactService — AI Gate 产物产出侧。
 *
 * pack(skill, content, format) → 生成产物字节 + 句柄。
 * 产物以「内存 + sha256」形式交付（经 API 流式下发），不落 Agent 目录。
 */
export class SkillArtifactService {
  /**
   * 打包一个 skill 为指定格式，返回产物字节 + ArtifactResult。
   * @param content 该 skill 的完整内容（SKILL.md + references + scripts）。
   */
  async pack(
    skill: SkillMeta,
    content: SkillContent,
    format: ArtifactFormat
  ): Promise<ArtifactResult> {
    const bytes =
      format === "agent-plugin"
        ? this.packAgentPlugin(skill, content)
        : this.packTarball(skill, content);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const version = content.version || skill.version || "1.0.0";
    return {
      skill: { ...skill, name: skill.name },
      format,
      version,
      sha256,
      generatedAt: new Date().toISOString(),
      bytes,
    };
  }

  /** 产出一个 Agent Plugin 目录的字节表示（UTF-8 JSON + SKILL.md + 附属）。 */
  private packAgentPlugin(skill: SkillMeta, content: SkillContent): Buffer {
    const parts: string[] = [];

    // plugin.json
    const manifest = buildPluginManifest(skill);
    parts.push(this.fileEntry("plugin.json", JSON.stringify(manifest, null, 2)));

    // skills/<name>/SKILL.md
    const pluginName = normalizePluginName(skill.name);
    parts.push(this.fileEntry(`skills/${pluginName}/SKILL.md`, content.skillMd));

    // references/ 与 scripts/（Agent Skills 规范固定位置）
    for (const [rel, text] of Object.entries(content.references || {})) {
      parts.push(this.fileEntry(`skills/${pluginName}/references/${rel}`, text));
    }
    for (const [rel, text] of Object.entries(content.scripts || {})) {
      parts.push(this.fileEntry(`skills/${pluginName}/scripts/${rel}`, text));
    }

    // 简单拼接：目录条目 + 文件条目（消费方可按 `\n---FILE <path>---\n` 切分）。
    return Buffer.from(parts.join(""), "utf8");
  }

  /** 产出一个中立 tarball 源码包的字节表示（简化：非 gzip，明确分隔）。 */
  private packTarball(skill: SkillMeta, content: SkillContent): Buffer {
    const parts: string[] = [];
    parts.push(
      this.fileEntry(
        "skill.json",
        JSON.stringify(
          {
            name: skill.name,
            version: content.version || skill.version || "1.0.0",
            description: skill.description,
            externalId: skill.externalId,
            ref: skill.ref,
            tags: skill.tags,
            artifact: skill.artifact,
          },
          null,
          2
        )
      )
    );
    parts.push(this.fileEntry("SKILL.md", content.skillMd));
    for (const [rel, text] of Object.entries(content.references || {})) {
      parts.push(this.fileEntry(`references/${rel}`, text));
    }
    for (const [rel, text] of Object.entries(content.scripts || {})) {
      parts.push(this.fileEntry(`scripts/${rel}`, text));
    }
    return Buffer.from(parts.join(""), "utf8");
  }

  private fileEntry(path: string, content: string): string {
    return `---FILE ${path}---\n${content}\n`;
  }
}

/** 解析后的产物文件条目。 */
export interface ArtifactFileEntry {
  path: string;
  content: string;
}

/**
 * 消费方解析器：把 AI Gate 产物字节按 `---FILE <path>---\n` 分隔切回文件集。
 * 这是产物的规范解码契约，供智能体（编排者/看护者）摄取产物用。
 */
export function parseArtifact(bytes: Buffer | string, format: ArtifactFormat): ArtifactFileEntry[] {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes;
  const lines = text.split("\n");
  const entries: ArtifactFileEntry[] = [];
  let curPath: string | null = null;
  const curBody: string[] = [];
  const keep = () => {
    if (curPath) {
      entries.push({ path: curPath, content: curBody.join("\n").replace(/\n$/, "") });
    }
    curPath = null;
    curBody.length = 0;
  };
  for (const line of lines) {
    const m = line.match(/^---FILE (.+?)---$/);
    if (m) {
      keep();
      curPath = m[1].trim();
    } else if (curPath) {
      curBody.push(line);
    }
  }
  keep();
  void format; // 目前两种格式同构；format 预留供未来差异化解析
  return entries;
}
