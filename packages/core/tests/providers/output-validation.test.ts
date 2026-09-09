import { describe, expect, it } from "vitest";

import { ProviderOutputBudget } from "../../src/providers/output-validation.js";

describe("provider output validation", () => {
  it("rejects malformed provider evidence and individual oversized output", () => {
    const invalid = new ProviderOutputBudget("eval");
    expect(() =>
      invalid.validateAndRecord({ content: "ok", latencyMs: Number.NaN }, "assertion invalid"),
    ).toThrow(expect.objectContaining({ code: "eval.output.invalid" }));

    const oversized = new ProviderOutputBudget("probe");
    expect(() =>
      oversized.validateAndRecord(
        { content: "x".repeat(5 * 1024 * 1024 + 1), latencyMs: 1 },
        "model/probe",
      ),
    ).toThrow(expect.objectContaining({ code: "probe.output.invalid" }));
  });

  it("stops a run before retained output exceeds its aggregate budget", () => {
    const budget = new ProviderOutputBudget("eval");
    const content = "x".repeat(4 * 1024 * 1024);
    for (let index = 0; index < 4; index += 1) {
      budget.validateAndRecord({ content, latencyMs: 1 }, `assertion ${index}`);
    }

    expect(() =>
      budget.validateAndRecord({ content: "x", latencyMs: 1 }, "assertion overflow"),
    ).toThrow(
      expect.objectContaining({
        code: "eval.output.invalid",
        why: expect.stringContaining("aggregate run limit"),
      }),
    );
    expect(() => budget.assertCanContinue()).toThrow(
      expect.objectContaining({ code: "eval.output.invalid" }),
    );
  });
});
