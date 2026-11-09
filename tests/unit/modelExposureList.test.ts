/**
 * modelExposureList 谓词单元测试（移植自上游 #11481）。
 * 覆盖：默认空名单 no-op、拒绝名单精确/glob、允许名单收敛、deny 优先于 allow、
 * 非法输入健壮性、provider/model 复合 id 匹配。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isModelExposureAllowed,
  hasAnyModelExposureEntries,
} from "@/shared/utils/modelExposureList";

describe("modelExposureList", () => {
  it("两个名单都为空 → 全部曝光（默认 opt-in 关闭）", () => {
    assert.equal(isModelExposureAllowed("openai", "gpt-4o", {}), true);
    assert.equal(isModelExposureAllowed("openai", "gpt-4o", null), true);
    assert.equal(isModelExposureAllowed("openai", "gpt-4o", undefined), true);
    assert.equal(
      isModelExposureAllowed("openai", "gpt-4o", {
        modelVisibilityAllowlist: [],
        modelVisibilityDenylist: [],
      }),
      true
    );
  });

  it("拒绝名单：裸模型名精确匹配被拒", () => {
    assert.equal(
      isModelExposureAllowed("openai", "gpt-4o", { modelVisibilityDenylist: ["gpt-4o"] }),
      false
    );
    assert.equal(
      isModelExposureAllowed("openai", "gpt-4o-mini", { modelVisibilityDenylist: ["gpt-4o"] }),
      true
    );
  });

  it("拒绝名单：provider/model 复合 id 精确匹配被拒", () => {
    assert.equal(
      isModelExposureAllowed("openai", "gpt-4o", {
        modelVisibilityDenylist: ["openai/gpt-4o"],
      }),
      false
    );
  });

  it("拒绝名单：glob 模式被拒（* 与 ?）", () => {
    assert.equal(
      isModelExposureAllowed("openai", "gpt-4o", { modelVisibilityDenylist: ["openai/*"] }),
      false
    );
    assert.equal(
      isModelExposureAllowed("openai", "gpt-4o", { modelVisibilityDenylist: ["gpt-?o"] }),
      false
    );
    assert.equal(
      isModelExposureAllowed("anthropic", "claude-3", { modelVisibilityDenylist: ["openai/*"] }),
      true
    );
  });

  it("允许名单非空 → 只保留匹配项", () => {
    const s = { modelVisibilityAllowlist: ["claude-*"] };
    assert.equal(isModelExposureAllowed("anthropic", "claude-3-opus", s), true);
    assert.equal(isModelExposureAllowed("openai", "gpt-4o", s), false);
  });

  it("deny 优先于重叠的 allow", () => {
    const s = {
      modelVisibilityAllowlist: ["claude-*"],
      modelVisibilityDenylist: ["claude-3-opus"],
    };
    assert.equal(isModelExposureAllowed("anthropic", "claude-3-opus", s), false);
    assert.equal(isModelExposureAllowed("anthropic", "claude-3-sonnet", s), true);
  });

  it("非法输入健壮：非数组 / 非字符串 / 空白条目被忽略", () => {
    assert.equal(
      isModelExposureAllowed("p", "m", { modelVisibilityDenylist: "not-an-array" }),
      true
    );
    assert.equal(
      isModelExposureAllowed("p", "m", { modelVisibilityDenylist: [1, null, {}, "  "] }),
      true
    );
    assert.equal(
      isModelExposureAllowed("p", "m", { modelVisibilityDenylist: ["", "   ", "m"] }),
      false
    );
  });

  it("非法 glob 不抛异常（回退为不匹配）", () => {
    assert.doesNotThrow(() =>
      isModelExposureAllowed("p", "m", { modelVisibilityDenylist: ["[invalid("] })
    );
  });

  it("hasAnyModelExposureEntries 正确反映是否设了名单", () => {
    assert.equal(hasAnyModelExposureEntries({}), false);
    assert.equal(hasAnyModelExposureEntries(null), false);
    assert.equal(hasAnyModelExposureEntries({ modelVisibilityAllowlist: [] }), false);
    assert.equal(hasAnyModelExposureEntries({ modelVisibilityDenylist: ["x"] }), true);
    assert.equal(hasAnyModelExposureEntries({ modelVisibilityAllowlist: ["x"] }), true);
  });
});
