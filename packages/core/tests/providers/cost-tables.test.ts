import { describe, expect, it } from "vitest";

import { lookupCostUsd } from "../../src/providers/cost-tables.js";

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
      model: "claude-3-5-haiku-latest",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });

    expect(cost).toBeCloseTo(0.8 + 4.0, 6);
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
});
