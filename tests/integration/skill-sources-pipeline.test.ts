/**
 * M1 多源闭环集成测试 — Skill Hub 源登记 + discover + install。
 *
 * git 源 v1.1 改为「AI Gate 用 curl+tar 拉取 archive HEAD tarball」模式
 * （零 git 依赖，适配磁盘受限设备；私有库集中授权）。测试用本地 HTTP
 * archive mock server 模拟 GitHub/Gitea `/archive/HEAD.tar.gz` 端点，
 * 无需外网（CI 友好），验证：
 *   1. createSkillSource 登记 gitea 源写库
 *   2. buildAdapterFromInstance → adapter.discover() 拉 tarball 发现技能
 *      （含 commitSha 提取 + 干净 sourceUrl 脱敏）
 *   3. adapter.fetch() 拉取完整 SKILL.md
 *   4. skillRegistry.register() 落库带 sourceKind/sourceRef/externalId
 *   5. listSkillSources 返回登记源
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const ep = promisify(execFile);
const { createSkillSource, listSkillSources, deleteSkillSource } =
  await import("../../src/lib/db/skillSources.ts");
const { buildAdapterFromInstance } = await import("../../src/lib/skills/adapters/index.ts");
const { skillRegistry } = await import("../../src/lib/skills/registry.ts");
const { getAsyncDb } = await import("../../src/lib/db/core.ts");

// 轮询等待迁移 138 完成（项目迁移是异步 fire-and-forget，主动确保就绪）
async function waitForMigration138(timeoutMs = 15000): Promise<void> {
  const db = await getAsyncDb();
  const start = Date.now();
  for (;;) {
    try {
      const r = await db.prepare("SELECT 1 FROM _omniroute_migrations WHERE version = '138'").get();
      if (r) return;
    } catch {
      /* 迁移表可能尚未创建 */
    }
    try {
      const has = await db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='skill_sources'")
        .get();
      if (has) return;
    } catch {
      /* ignore */
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for migration 138 (skill_sources)");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
await waitForMigration138();

// ── 本地 HTTP archive mock server（模拟 GitHub/Gitea tarball 端点）──
const COMMIT_SHA = "abcdef1234567890abcdef1234567890abcdef12";
let mockServer: Server;
let mockPort = 0;

async function startMockArchiveServer(): Promise<string> {
  const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillhub-mock-"));
  const repoDir = path.join(stageDir, `demo-repo-${COMMIT_SHA}`);
  await fs.mkdir(path.join(repoDir, "skills", "core"), { recursive: true });
  await fs.writeFile(
    path.join(repoDir, "skills", "core", "SKILL.md"),
    `---\nname: Core Helper\nversion: 1.2.0\ndescription: Mock skill from tarball source\n---\n# Core Helper\n\nMock body for tarball-based git source test.\n`
  );
  await fs.writeFile(path.join(repoDir, "README.md"), `# demo-repo\n`);

  mockServer = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (/\/archive\/HEAD\.tar\.gz$/.test(u.pathname)) {
      try {
        const full = path.join(stageDir, "full.tar.gz");
        await ep("tar", ["-C", path.dirname(repoDir), "-czf", full, path.basename(repoDir)]);
        const body = await fs.readFile(full);
        res.writeHead(200, { "content-type": "application/gzip", "x-commit-sha": COMMIT_SHA });
        res.end(body);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    } else {
      res.writeHead(404);
      res.end("missing");
    }
  });
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  mockPort = (mockServer.address() as { port: number }).port;
  return `http://127.0.0.1:${mockPort}/gitea/demo-repo`;
}

test("M1: tarball 源 discover → install → 列表（含 commitSha + 脱敏 sourceUrl）", async () => {
  const repoUrl = await startMockArchiveServer();
  try {
    // 1. 登记源（url 指向本地 mock archive 端点）
    const src = await createSkillSource({
      kind: "github-public",
      name: "demo-mock",
      url: repoUrl,
      skillsPath: "skills",
    });
    assert.ok(src.id, "源应返回 id");
    assert.equal(src.kind, "github-public");
    assert.equal(src.enabled, true, "新登记源默认启用");

    // 2. discover（用 adapter 实例，走 tarball 拉取）
    const adapter = buildAdapterFromInstance(src);
    assert.ok(adapter, "源应能构建 adapter");
    assert.equal(adapter.writable, false, "源 adapter 必须只读");

    const metas = await adapter.discover();
    assert.ok(metas.length >= 1, "应至少发现 1 个技能");
    const meta = metas[0];
    assert.ok(meta.name, "发现项应有 name");
    assert.equal(meta.externalId, `${src.id}::core`, "externalId 应为 id::entryName");
    assert.equal(meta.commitSha, COMMIT_SHA, "应提取正确 commit SHA 供更新追踪");
    assert.equal(meta.sourceUrl, repoUrl, "sourceUrl 应为干净的仓库 URL（脱敏）");

    // 3. fetch
    const content = await adapter.fetch(meta);
    assert.ok(content.skillMd.length > 100, "SKILL.md 应非空且有实质内容");
    assert.match(content.skillMd, /^---/, "SKILL.md 应含 frontmatter");

    // 4. register 落库（带新源字段）
    const skill = await skillRegistry.register({
      name: meta.name,
      version: meta.version || "1.0.0",
      description: meta.description || "",
      schema: { input: { content: "string" }, output: { result: "string" } },
      handler: `// from ${meta.externalId}\n${content.skillMd}`,
      apiKeyId: "github-public",
      enabled: true,
      mode: "auto",
      sourceKind: "github-public",
      sourceRef: src.id,
      externalId: meta.externalId,
      artifact: "agentskill",
      tags: ["source:github-public"],
      installCount: 1,
    });
    assert.ok(skill.id, "注册应返回 skill id");
    assert.equal(skill.sourceKind, "github-public", "skill 应带 sourceKind");
    assert.equal(skill.sourceRef, src.id, "skill 应带 sourceRef");

    // 5. list 确认
    const sources = await listSkillSources();
    const found = sources.find((s) => s.id === src.id);
    assert.ok(found, "登记的源应出现在列表");

    // 清理：删源 + 删 skill
    await deleteSkillSource(src.id);
    const db = await getAsyncDb();
    await db.prepare("DELETE FROM skills WHERE id = ?").run(skill.id);
  } finally {
    mockServer.close();
  }
});
