import { describe, expect, it } from "vitest";

import {
  buildLiveProvider,
  enforceRunConfirmation,
  parseCostBudget,
} from "../src/provider-gate.js";

const env = { AIDRIFT_OPENAI_API_KEY: "sk-test" };

describe("buildLiveProvider", () => {
  it("rejects a provider override that disagrees with the model artifact", () => {
    expect(() =>
      buildLiveProvider(
        "openai",
        { name: "primary", provider: "anthropic", model: "claude-test" },
        env,
      ),
    ).toThrow(expect.objectContaining({ code: "probe.provider.model_mismatch", exitCode: 2 }));
  });

  it("accepts model parameters now that adapters apply them", () => {
    expect(() =>
      buildLiveProvider(
        "openai",
        {
          name: "primary",
          provider: "openai",
          model: "gpt-test",
          parameters: { temperature: 0.2 },
        },
        env,
      ),
    ).not.toThrow();
  });

  it("rejects unsupported model parameters before a request", () => {
    expect(() =>
      buildLiveProvider(
        "openai",
        {
          name: "primary",
          provider: "openai",
          model: "gpt-test",
          parameters: { arbitrary_unsafe_field: true },
        },
        env,
      ),
    ).toThrow(expect.objectContaining({ code: "provider.bad_request", exitCode: 2 }));
  });
});

describe("live cost gate", () => {
  const unpriced = {
    modelCount: 1,
    probeCount: 4,
    samples: 5,
    requestCount: 20,
    estimatedInputTokens: 1_000,
    estimatedOutputTokens: 2_000,
    unknownModels: ["primary (openai/future-model)"],
    pricingAsOf: "2026-09-02",
  } as const;

  it("rejects malformed budgets instead of treating them as missing", () => {
    expect(() => parseCostBudget("12oops")).toThrow(
      expect.objectContaining({ code: "probe.budget.invalid", exitCode: 2 }),
    );
  });

  it("cannot enforce a dollar budget when selected model pricing is unknown", () => {
    expect(() => enforceRunConfirmation(unpriced, false, "1.00")).toThrow(
      expect.objectContaining({ code: "probe.cost.unknown", exitCode: 2 }),
    );
    expect(() => enforceRunConfirmation(unpriced, true, "1.00")).toThrow(
      expect.objectContaining({ code: "probe.cost.unknown", exitCode: 2 }),
    );
    expect(() => enforceRunConfirmation(unpriced, true, undefined)).not.toThrow();
  });
});
