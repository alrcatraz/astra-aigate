/**
 * gitRepoAdapter.ts — 项目附属 repo（github-public / gitea）源适配器 (Phase 4 M1→M1.1)
 *
 * ★ 2026-08-09 重设计：从「git clone + 机械扫描 skills/」升级为「AI Gate 集中授权
 *   拉取 tarball → 脱敏 → 契约产物交给智能体自行分析」。理由：
 *   - 满足硬盘/内存受限设备（容器不打 git 包，curl+tar 已在 base 镜像）
 *   - 私有库集中授权：AI Gate 是唯一凭据持有者，token 不扩散到智能体
 *   - 附属项目的 skill 可能是 MCP/服务的指南，需智能体结合项目语义分析，
 *     而非机械扫描 `skills/` 目录格式
 *   - tarball 保留干净 sourceUrl + commit SHA，供智能体溯源、追踪、提交上游
 *
 * 边界（设计纪律）：AI Gate 只「拉取 tarball + 脱敏 + 打包成契约产物」，不落地
 * 到任何 Agent 目录，不机械 install，由消费方智能体分析。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SkillContent, SkillMeta, SkillSourceAdapter, SkillSourceKind } from "../sourceKind";
import { parseFrontmatter } from "./frontmatter";

const execFileP = promisify(execFile);

interface GitRepoOptions {
  kind: "github-public" | "gitea";
  id: string;
  displayName: string;
  /** 仓库 git/http(s) 地址。私有库经 tokenEnv 注入认证。 */
  repoUrl: string;
  /** repo 内 skills 目录相对路径，默认 "skills"。 */
  skillsPath?: string;
  /** 环境变量名，存访问私有 repo 的 token（如 GITEA_SKILL_TOKEN）。 */
  tokenEnv?: string;
}

/**
 * GitHub/Gitea archive HEAD tarball 端点。
 * 两者都支持 `<repo>/archive/HEAD.tar.gz`（默认分支最新 commit），
 * 顶层目录名携带 commit SHA（`<repo>-<sha>/`），供更新追踪。
 */
function tarballUrl(repoUrl: string): string {
  const m = repoUrl.match(/^(https?:\/\/)([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`Unsupported repo URL: ${repoUrl}`);
  const scheme = m[1];
  const host = m[2];
  const owner = m[3];
  const repo = m[4];
  return `${scheme}${host}/${owner}/${repo}/archive/HEAD.tar.gz`;
}

export class GitRepoAdapter implements SkillSourceAdapter {
  readonly kind: SkillSourceKind;
  readonly id: string;
  readonly displayName: string;
  readonly writable: false = false;

  private repoUrl: string;
  private skillsPath: string;
  private tokenEnv?: string;

  constructor(opts: GitRepoOptions) {
    this.kind = opts.kind;
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.repoUrl = opts.repoUrl;
    this.skillsPath = opts.skillsPath || "skills";
    this.tokenEnv = opts.tokenEnv;
  }

  /** 干净 sourceUrl（剥离 oauth2/token/凭证），随契约产物交给智能体溯源用。 */
  sanitizedRepoUrl(): string {
    const m = this.repoUrl.match(/^(https?:\/\/)(?:[^/@]+@)?([^/]+)(\/.*)$/);
    if (!m) return this.repoUrl;
    return `${m[1]}${m[2]}${m[3]}`;
  }

  /** 私有库认证 header（Authorization），绝不在 tarball/产物中注入 token。 */
  private authHeader(): Record<string, string> {
    if (!this.tokenEnv) return {};
    const token = process.env[this.tokenEnv];
    if (!token) return {};
    // GitHub 私有: `Bearer <token>`；Gitea 私有: `token <token>`
    const isGitea = this.kind === "gitea";
    return {
      Authorization: isGitea ? `token ${token}` : `Bearer ${token}`,
    };
  }

  /**
   * curl 拉取 archive HEAD tarball 并解压到临时目录，返回 { dir, commitSha }。
   * 零 git 依赖（curl + tar 已在容器 base 镜像）。用完调用方负责清理。
   */
  private async fetchTarballOnce(): Promise<{ dir: string; commitSha: string | null }> {
    const url = tarballUrl(this.repoUrl);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skillhub-tar-"));
    const archive = path.join(tmpRoot, "repo.tar.gz");
    const headers = this.authHeader();
    const headerArgs = Object.entries(headers).map(([k, v]) => ["-H", `${k}: ${v}`]);
    const curlArgs = ["-sSL", "--max-time", "120", ...headerArgs.flat(), "-o", archive, url];
    try {
      await execFileP("curl", curlArgs);
      // 解压；archive 顶层是 `<repo>-<sha>/`
      await execFileP("tar", ["-xzf", archive, "-C", tmpRoot]);
      await fs.rm(archive, { force: true });
      // 找顶层目录名提取 commit SHA
      const entries = await fs.readdir(tmpRoot, { withFileTypes: true });
      const topDir = entries.find((e) => e.isDirectory());
      let commitSha: string | null = null;
      if (topDir) {
        const slug = topDir.name;
        const match = slug.match(/-([0-9a-f]{7,40})$/);
        commitSha = match ? match[1] : null;
      }
      if (!topDir) throw new Error("Archive contains no directory");
      return { dir: path.join(tmpRoot, topDir.name), commitSha };
    } catch (err) {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `tarball fetch failed for ${this.displayName}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async discover(): Promise<SkillMeta[]> {
    const { dir, commitSha } = await this.fetchTarballOnce();
    try {
      const skillsRoot = path.join(dir, this.skillsPath);
      let items: import("node:fs").Dirent[];
      try {
        items = await fs.readdir(skillsRoot, { withFileTypes: true });
      } catch {
        return []; // skills 目录不存在 → 无已结构化的技能（仍需智能体分析全仓）
      }
      const metas: SkillMeta[] = [];
      for (const item of items) {
        const skillDir = path.join(skillsRoot, item.name);
        const skillMdFile = item.isDirectory()
          ? path.join(skillDir, "SKILL.md")
          : item.name.endsWith(".md")
            ? skillDir
            : null;
        if (!skillMdFile) continue;
        try {
          const content = await fs.readFile(skillMdFile, "utf8");
          const fm = parseFrontmatter(content);
          if (!fm.name) continue;
          metas.push({
            name: fm.name,
            version: fm.version,
            description: fm.description,
            externalId: `${this.id}::${item.name}`,
            ref: this.skillsPath,
            artifact: "agentskill",
            sourceUrl: this.sanitizedRepoUrl(),
            commitSha: commitSha ?? undefined,
          });
        } catch {
          /* 跳过无法读取的条目 */
        }
      }
      return metas;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async fetch(meta: SkillMeta): Promise<SkillContent> {
    const { dir } = await this.fetchTarballOnce();
    try {
      const entryName = meta.externalId.split("::").pop()!;
      const skillsRoot = path.join(dir, this.skillsPath);
      const fileStat = await fs.stat(path.join(skillsRoot, entryName));
      if (fileStat.isDirectory()) {
        const skillDir = path.join(skillsRoot, entryName);
        const skillMd = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
        return { name: meta.name, version: meta.version || "0.0.0", skillMd };
      }
      const skillMd = await fs.readFile(path.join(skillsRoot, entryName), "utf8");
      return { name: meta.name, version: meta.version || "0.0.0", skillMd };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
