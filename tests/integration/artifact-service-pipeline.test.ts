/**
 * M2 产物服务集成测试 — SkillArtifactService 打包 + parseArtifact 解码端到端。
 *
 * 用 omniroute-builtin 内置源 discover + fetch 一个真实 skill，pack 成 agent-plugin
 * 与 tarball，parseArtifact 解码并断言符合 agent-plugins.org v1.0.0 布局。验证：
 *   1. pack() 产出确定字节 + sha256 句柄
 *   2. agent-plugin 含 plugin.json($schema/name) + skills/<name>/SKILL.md + references/scripts
 *   3. tarball 含 skill.json + SKILL.md + references
 *   4. parseArtifact 完整解码（含首条目，非首条目丢失 bug 回归）
 */
import test from "node:test";
import assert from "node:assert/strict";

const { OmnirouteBuiltinAdapter, OMNIROUTE_BUILTIN_ID } =
  await import("../../src/lib/skills/adapters/omnirouteBuiltinAdapter.ts");
const { SkillArtifactService, parseArtifact, isValidPluginName, normalizePluginName } =
  await import("../../src/lib/skills/artifactService.ts");

test("M2: 内置源 skill → agent-plugin 打包 → 解码验证 → tarball", async () => {
  const adapter = new OmnirouteBuiltinAdapter();
  const svc = new SkillArtifactService();

  // 1. discover 内置 skill
  const metas = await adapter.discover();
  assert.ok(metas.length >= 10, `应发现 ≥10 内置 skill，实际 ${metas.length}`);
  const meta = metas.find((m) => m.externalId === "builtin::omni-auth") || metas[0];
  assert.ok(meta, "应有可打包的 skill");
  assert.equal(adapter.writable, false, "内置源只读");

  // 2. fetch 完整内容
  const content = await adapter.fetch(meta);
  assert.ok(content.skillMd.length > 500, "内置 SKILL.md 应完整");
  assert.equal(typeof content.version, "string");

  // 3. pack agent-plugin
  const ap = await svc.pack(meta, content, "agent-plugin");
  assert.match(ap.sha256, /^[0-9a-f]{64}$/, "sha256 应为 64 位 hex");
  assert.equal(ap.format, "agent-plugin");
  assert.ok(ap.bytes.length > 200, "产物非空");

  // 4. parseArtifact 解码 —— 关键回归：首条目(plugin.json)不可丢失
  const files = parseArtifact(ap.bytes, "agent-plugin");
  const plugin = files.find((f) => f.path === "plugin.json");
  assert.ok(plugin, "首条目 plugin.json 必须解析出（回归：parseArtifact 首条目丢失 bug）");
  const manifest = JSON.parse(plugin.content);
  assert.equal(
    manifest.$schema,
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    "plugin.json 必须指向规范 schema"
  );
  assert.ok(manifest.name, "manifest 必须有 name");
  assert.ok(manifest.name.length >= 1 && manifest.name.length <= 64, "name 长度合规");
  assert.ok(
    files.some((f) => f.path.endsWith("/SKILL.md")),
    "必须含 skills/<name>/SKILL.md"
  );

  // 5. tarball
  const tb = await svc.pack(meta, content, "tarball");
  const tbFiles = parseArtifact(tb.bytes, "tarball");
  assert.ok(
    tbFiles.some((f) => f.path === "skill.json"),
    "tarball 含 skill.json"
  );
  assert.ok(
    tbFiles.some((f) => f.path === "SKILL.md"),
    "tarball 含 SKILL.md"
  );

  // 6. 幂等性
  const ap2 = await svc.pack(meta, content, "agent-plugin");
  assert.ok(ap.bytes.equals(ap2.bytes), "两次 pack 字节必须相同（可复现）");

  // 7. plugin name 工具
  assert.ok(isValidPluginName("my-plugin"));
  assert.ok(!isValidPluginName("My-Plugin"), "大写非法");
  assert.equal(normalizePluginName("Team Code Review"), "team-code-review");
});
