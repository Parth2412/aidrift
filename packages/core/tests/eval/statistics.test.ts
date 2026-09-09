import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { analyzeScoreRegression, distribution } from "../../src/eval/statistics.js";

describe("eval statistics", () => {
  it("uses one-sided Fisher exact evidence for binary score regressions", () => {
    const result = analyzeScoreRegression([0, 0, 0, 0, 0], [1, 1, 1, 1, 1], 0.05);

    expect(result.method).toBe("fisher_exact");
    expect(result.delta).toBe(-1);
    expect(result.pValue).toBeCloseTo(0.003968, 6);
    expect(result.significant).toBe(true);
  });

  it("does not call identical binary distributions regressions", () => {
    const result = analyzeScoreRegression([1, 1, 1, 1, 1], [1, 1, 1, 1, 1], 0.05);

    expect(result.pValue).toBe(1);
    expect(result.significant).toBe(false);
  });

  it("uses Welch's t-test for continuous score distributions", () => {
    const result = analyzeScoreRegression(
      [0.3, 0.35, 0.4, 0.45, 0.5],
      [0.8, 0.85, 0.9, 0.95, 1],
      0.05,
    );

    expect(result.method).toBe("welch_t");
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.significant).toBe(true);
    expect(result.confidenceInterval[1]).toBeLessThan(0);
  });

  it("calculates sample standard deviation and rejects empty distributions", () => {
    expect(distribution([0, 1])).toMatchObject({
      sampleCount: 2,
      mean: 0.5,
      standardDeviation: 0.707107,
    });
    expect(() => distribution([])).toThrow(RangeError);
  });

  it("handles zero-variance continuous samples in both directions", () => {
    const regression = analyzeScoreRegression([0.5], [0.75], 0.05);
    const improvement = analyzeScoreRegression([0.75], [0.5], 0.05);

    expect(regression).toMatchObject({ method: "welch_t", pValue: 0, significant: true });
    expect(improvement).toMatchObject({ method: "welch_t", pValue: 1, significant: false });
  });

  it("reports a non-regressing continuous distribution as non-significant", () => {
    const result = analyzeScoreRegression(
      [0.8, 0.85, 0.9, 0.95, 1],
      [0.3, 0.35, 0.4, 0.45, 0.5],
      0.1,
    );

    expect(result.pValue).toBeGreaterThan(0.99);
    expect(result.significant).toBe(false);
    expect(result.confidenceLevel).toBe(0.9);
  });

  it("rejects invalid significance levels and non-finite score samples", () => {
    expect(() => analyzeScoreRegression([1], [1], 0)).toThrow(RangeError);
    expect(() => analyzeScoreRegression([1], [1], 1)).toThrow(RangeError);
    expect(() => analyzeScoreRegression([Number.NaN], [1], 0.05)).toThrow(RangeError);
    expect(() => analyzeScoreRegression([1], [Number.POSITIVE_INFINITY], 0.05)).toThrow(RangeError);
  });

  it("preserves statistical invariants across generated finite distributions", () => {
    const scores = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
      minLength: 1,
      maxLength: 20,
    });

    fc.assert(
      fc.property(scores, scores, (current, baseline) => {
        const result = analyzeScoreRegression(current, baseline, 0.05);
        const currentDistribution = distribution(current);

        expect(result.current.sampleCount).toBe(current.length);
        expect(result.baseline.sampleCount).toBe(baseline.length);
        expect(result.pValue).toBeGreaterThanOrEqual(0);
        expect(result.pValue).toBeLessThanOrEqual(1);
        expect(Number.isFinite(result.delta)).toBe(true);
        expect(Number.isFinite(result.confidenceInterval[0])).toBe(true);
        expect(Number.isFinite(result.confidenceInterval[1])).toBe(true);
        expect(currentDistribution.mean).toBeGreaterThanOrEqual(Math.min(...current) - 0.000001);
        expect(currentDistribution.mean).toBeLessThanOrEqual(Math.max(...current) + 0.000001);
        expect(currentDistribution.standardDeviation).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 250 },
    );
  });

  it("never classifies identical generated samples as a regression", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: 1,
          maxLength: 20,
        }),
        (samples) => {
          const result = analyzeScoreRegression(samples, samples, 0.05);
          expect(result.delta).toBe(0);
          expect(result.significant).toBe(false);
        },
      ),
      { numRuns: 250 },
    );
  });
});
