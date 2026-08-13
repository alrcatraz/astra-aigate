import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCostWithCurrency } from "../../src/lib/usage/costCalculator";

const USD_PRICING = {
  input: 2.5, // $/M tokens
  output: 10,
};

const TOKENS = {
  input: 1_000_000,
  output: 100_000,
  cacheRead: 0,
  cacheCreation: 0,
  reasoning: 0,
};

describe("computeCostWithCurrency", () => {
  it("returns USD for USD-billing providers (default)", () => {
    const result = computeCostWithCurrency(USD_PRICING, TOKENS, {
      provider: "mistral",
      model: "x",
    });
    assert.equal(result.currency, "USD");
    assert.ok(Math.abs(result.amount - (2.5 + 1.0)) < 1e-9);
  });

  it("returns CNY for CNY-billing providers (converted at 7.1)", () => {
    const result = computeCostWithCurrency(USD_PRICING, TOKENS, {
      provider: "zhipu",
      model: "x",
    });
    assert.equal(result.currency, "CNY");
    // USD 3.5 × 7.1 = 24.85
    assert.ok(Math.abs(result.amount - 3.5 * 7.1) < 1e-9);
  });

  it("returns CNY for usageConfigs CNY providers (dmxapi-cn)", () => {
    const result = computeCostWithCurrency(USD_PRICING, TOKENS, {
      provider: "dmxapi-cn",
      model: "x",
    });
    assert.equal(result.currency, "CNY");
  });

  it("returns USD for usageConfigs USD providers (siliconflow)", () => {
    const result = computeCostWithCurrency(USD_PRICING, TOKENS, {
      provider: "siliconflow",
      model: "x",
    });
    assert.equal(result.currency, "USD");
  });

  it("zero amount with USD default when pricing missing", () => {
    const result = computeCostWithCurrency(null, TOKENS, {
      provider: "unknown",
      model: "x",
    });
    assert.equal(result.amount, 0);
    assert.equal(result.currency, "USD");
  });
});
