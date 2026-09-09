import { describe, expect, it } from "vitest";

import { lookupCostUsd, lookupModelPriceUsdPerMillion } from "../../src/providers/cost-tables.js";

describe("lookupCostUsd", () => {
  it("computes cost for a known openai model from input and output tokens", () => {
    const cost = lookupCostUsd({
      providerId: "openai",
      model: "gpt-4o-mini",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });

    expect(cost).toBeCloseTo(0.15 + 0.6, 6);
  });

  it("computes cost for a known anthropic model from input and output tokens", () => {
    const cost = lookupCostUsd({
      providerId: "anthropic",
      model: "claude-haiku-4-5-20251001",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });

    expect(cost).toBeCloseTo(1 + 5, 6);
  });

  it("returns 0 for zero usage on a known model", () => {
    const cost = lookupCostUsd({
      providerId: "openai",
      model: "gpt-4o",
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    expect(cost).toBe(0);
  });

  it("returns undefined for an unknown model rather than throwing", () => {
    const cost = lookupCostUsd({
      providerId: "openai",
      model: "definitely-not-a-real-model-2099",
      usage: { inputTokens: 100, outputTokens: 100 },
    });

    expect(cost).toBeUndefined();
  });

  it("returns undefined for an unknown provider", () => {
    const cost = lookupCostUsd({
      providerId: "made-up",
      model: "any-model",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    expect(cost).toBeUndefined();
  });

  it("rounds positive sub-cent values without losing precision", () => {
    const cost = lookupCostUsd({
      providerId: "openai",
      model: "gpt-4o-mini",
      usage: { inputTokens: 1_000, outputTokens: 1_000 },
    });

    expect(cost).toBeCloseTo(0.00015 + 0.0006, 8);
  });

  it("uses current first-party prices with verification metadata", () => {
    expect(lookupModelPriceUsdPerMillion("openai", "gpt-5-mini")).toMatchObject({
      input: 0.25,
      output: 2,
      verifiedOn: "2026-09-08",
    });
    expect(lookupModelPriceUsdPerMillion("anthropic", "claude-haiku-4-5-20251001")).toMatchObject({
      input: 1,
      output: 5,
      verifiedOn: "2026-09-08",
    });
    expect(lookupModelPriceUsdPerMillion("anthropic", "claude-sonnet-4-6")).toMatchObject({
      input: 3,
      output: 15,
    });
    expect(lookupModelPriceUsdPerMillion("anthropic", "claude-sonnet-5")).toMatchObject({
      input: 2,
      output: 10,
    });
    expect(lookupModelPriceUsdPerMillion("anthropic", "claude-fable-5-1")).toMatchObject({
      input: 10,
      output: 50,
    });
    expect(lookupModelPriceUsdPerMillion("anthropic", "claude-opus-4-5-20251101")).toMatchObject({
      input: 5,
      output: 25,
    });
  });

  it("does not treat retired first-party Anthropic model IDs as budget-verifiable", () => {
    expect(lookupModelPriceUsdPerMillion("anthropic", "claude-3-5-haiku-20241022")).toBeUndefined();
    expect(lookupModelPriceUsdPerMillion("anthropic", "claude-3-opus-20240229")).toBeUndefined();
  });

  it("applies documented long-context multipliers to GPT-5.6 requests", () => {
    expect(
      lookupCostUsd({
        providerId: "openai",
        model: "gpt-5.6-terra",
        usage: { inputTokens: 300_000, outputTokens: 10_000 },
      }),
    ).toBeCloseTo(300_000 * 2e-6 * 2 + 10_000 * 12e-6 * 1.5, 8);
  });
});
