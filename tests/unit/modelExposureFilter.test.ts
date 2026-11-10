/**
 * modelExposureFilter 单元测试（移植自上游 #11481）。
 * 覆盖：空名单 identity（同一数组引用，零分配）、拒绝/允许过滤、允许名单清空池。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterModelExposureCandidates } from "../../open-sse/services/autoCombo/modelExposureFilter.ts";

const pool = [
  { provider: "openai", model: "gpt-4o" },
  { provider: "anthropic", model: "claude-3-opus" },
  { provider: "openai", model: "text-embedding-3" },
];

describe("modelExposureFilter", () => {
  it("空名单 → 返回同一数组引用（identity，零行为变化）", () => {
    assert.equal(filterModelExposureCandidates(pool, {}), pool);
    assert.equal(filterModelExposureCandidates(pool, null), pool);
    assert.equal(filterModelExposureCandidates(pool, undefined), pool);
    assert.equal(
      filterModelExposureCandidates(pool, {
        modelVisibilityDenylist: [],
        modelVisibilityAllowlist: [],
      }),
      pool
    );
  });

  it("拒绝名单过滤掉匹配候选（provider/model 复合 id）", () => {
    const out = filterModelExposureCandidates(pool, {
      modelVisibilityDenylist: ["openai/gpt-4o"],
    });
    assert.deepEqual(out, [
      { provider: "anthropic", model: "claude-3-opus" },
      { provider: "openai", model: "text-embedding-3" },
    ]);
  });

  it("拒绝名单：裸模型名只命中该模型", () => {
    const out = filterModelExposureCandidates(pool, {
      modelVisibilityDenylist: ["gpt-4o"],
    });
    assert.deepEqual(out, [
      { provider: "anthropic", model: "claude-3-opus" },
      { provider: "openai", model: "text-embedding-3" },
    ]);
  });

  it("glob 拒绝名单过滤", () => {
    const out = filterModelExposureCandidates(pool, { modelVisibilityDenylist: ["openai/*"] });
    assert.deepEqual(out, [{ provider: "anthropic", model: "claude-3-opus" }]);
  });

  it("允许名单收敛到匹配项", () => {
    const out = filterModelExposureCandidates(pool, { modelVisibilityAllowlist: ["claude-*"] });
    assert.deepEqual(out, [{ provider: "anthropic", model: "claude-3-opus" }]);
  });

  it("允许名单可清空池（由调用方空池路径兜底）", () => {
    const out = filterModelExposureCandidates(pool, {
      modelVisibilityAllowlist: ["nonexistent-*"],
    });
    assert.deepEqual(out, []);
  });

  it("不修改原池（纯函数）", () => {
    const copy = JSON.parse(JSON.stringify(pool));
    filterModelExposureCandidates(pool, { modelVisibilityDenylist: ["openai"] });
    assert.deepEqual(pool, copy);
  });
});
