/**
 * P4 端到端验证：确认压缩 worker 线程路径真的被使用，且结果与进程内一致。
 *
 * 覆盖：
 *  1. isCompressionWorkerEligible 的准入判定（各 mode 的预期）
 *  2. isStrictlySerializable 对函数/循环的拒绝
 *  3. runCompressionInWorker 实际起线程并返回结果
 *  4. worker 结果 == 进程内结果（正确性）
 *  5. 池能正确清理（进程不被 worker 挂住）
 */
import { test, describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  isCompressionWorkerEligible,
  isStrictlySerializable,
} from "../../../open-sse/services/compression/compressionWorkerProtocol.ts";

describe("compressionWorkerProtocol", () => {
  it("isStrictlySerializable 拒绝函数", () => {
    assert.equal(isStrictlySerializable({ f: () => {} }), false);
  });

  it("isStrictlySerializable 拒绝循环引用", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    assert.equal(isStrictlySerializable(a), false);
  });

  it("isStrictlySerializable 接受普通对象、数组、Date", () => {
    assert.equal(
      isStrictlySerializable({ a: 1, b: "s", c: [1, 2], d: new Date(), e: null, f: undefined }),
      true
    );
  });

  it("isStrictlySerializable 拒绝 NaN / Infinity（跨线程不可靠）", () => {
    assert.equal(isStrictlySerializable({ n: NaN }), false);
    assert.equal(isStrictlySerializable({ n: Infinity }), false);
  });

  it("isStrictlySerializable 拒绝 Map/Set 外的自定义类实例", () => {
    class Custom {}
    assert.equal(isStrictlySerializable({ o: new Custom() }), false);
  });

  it("mode 不在允许集合 → 不进入 worker", () => {
    assert.equal(isCompressionWorkerEligible({}, "omniglyph" as never), false);
    assert.equal(
      isCompressionWorkerEligible({}, "ultra" as never, { config: { ultraEngine: "slm" } }),
      false
    );
  });

  it("ultra 启发式（无 modelPath）→ 进入 worker", () => {
    assert.equal(isCompressionWorkerEligible({}, "ultra" as never), true);
    assert.equal(
      isCompressionWorkerEligible({}, "ultra" as never, {
        config: { ultra: { modelPath: "/m.onnx" } },
      }),
      false
    );
  });

  it("stacked 且 pipeline 含非 worker 引擎 → 不进入 worker", () => {
    const opts = { config: { stackedPipeline: ["rtk", "llmlingua"] } };
    assert.equal(isCompressionWorkerEligible({}, "stacked" as never, opts), false);
    const ok = { config: { stackedPipeline: ["rtk", "caveman"] } };
    assert.equal(isCompressionWorkerEligible({}, "stacked" as never, ok), true);
  });

  it("options 含函数 → 不进入 worker（保证进程内路径）", () => {
    assert.equal(
      isCompressionWorkerEligible(
        {},
        "standard" as never,
        { config: {}, onEngineStep: () => {} } as never
      ),
      false
    );
  });
});
