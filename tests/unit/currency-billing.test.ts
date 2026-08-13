import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getProviderBillingCurrency,
  convertAmount,
  DEFAULT_USD_CNY_RATE,
  roundCost,
} from "../../src/lib/usage/currency";

describe("getProviderBillingCurrency", () => {
  it("returns USD for null/undefined/empty provider", () => {
    assert.equal(getProviderBillingCurrency(null), "USD");
    assert.equal(getProviderBillingCurrency(undefined), "USD");
    assert.equal(getProviderBillingCurrency(""), "USD");
    assert.equal(getProviderBillingCurrency("   "), "USD");
  });

  it("maps CNY-billing providers from usageConfigs.quotaCurrency", () => {
    assert.equal(getProviderBillingCurrency("dmxapi-cn"), "CNY");
    assert.equal(getProviderBillingCurrency("siliconflow-cn"), "CNY");
  });

  it("maps USD-billing providers from usageConfigs.quotaCurrency", () => {
    assert.equal(getProviderBillingCurrency("dmxapi-com"), "USD");
    assert.equal(getProviderBillingCurrency("dmxapi-ssvip"), "USD");
    assert.equal(getProviderBillingCurrency("siliconflow"), "USD");
  });

  it("maps CNY allowlist providers (zhipu/glm/bigmodel)", () => {
    assert.equal(getProviderBillingCurrency("zhipu"), "CNY");
    assert.equal(getProviderBillingCurrency("glm"), "CNY");
    assert.equal(getProviderBillingCurrency("bigmodel"), "CNY");
  });

  it("defaults to USD for unknown providers", () => {
    assert.equal(getProviderBillingCurrency("mistral"), "USD");
    assert.equal(getProviderBillingCurrency("huggingface"), "USD");
    assert.equal(getProviderBillingCurrency("totally-unknown-provider"), "USD");
  });

  it("is case-insensitive and trims input", () => {
    assert.equal(getProviderBillingCurrency("DMXAPI-CN"), "CNY");
    assert.equal(getProviderBillingCurrency("  Zhipu  "), "CNY");
  });
});

describe("convertAmount", () => {
  it("is a no-op when currencies match", () => {
    assert.equal(convertAmount(5, "USD", "USD", 7.1), 5);
    assert.equal(convertAmount(5, "CNY", "CNY", 7.1), 5);
  });

  it("converts USD to CNY at the reference rate", () => {
    assert.equal(convertAmount(1, "USD", "CNY", 7.1), 7.1);
    assert.equal(convertAmount(0.5, "USD", "CNY", 7.2), 3.6);
  });

  it("converts CNY to USD by dividing", () => {
    assert.equal(convertAmount(7.1, "CNY", "USD", 7.1), 1);
    assert.equal(convertAmount(14.4, "CNY", "USD", 7.2), 2);
  });

  it("uses the default rate when none is provided", () => {
    assert.equal(convertAmount(1, "USD", "CNY"), DEFAULT_USD_CNY_RATE);
  });

  it("guards non-finite amounts", () => {
    assert.equal(convertAmount(Number.NaN, "USD", "CNY"), 0);
    assert.equal(convertAmount(Number.POSITIVE_INFINITY, "USD", "CNY"), 0);
  });
});

describe("roundCost", () => {
  it("rounds to 4 decimal places", () => {
    assert.equal(roundCost(0.1234567), 0.1235);
    assert.equal(roundCost(1.23456789), 1.2346);
  });

  it("guards non-finite input", () => {
    assert.equal(roundCost(Number.NaN), 0);
    assert.equal(roundCost(Number.POSITIVE_INFINITY), 0);
  });
});
