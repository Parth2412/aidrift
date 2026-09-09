import { describe, expect, it } from "vitest";

import type { PlanRunResult } from "../../src/eval/types.js";
import type { ProbeRunResult } from "../../src/probe/types.js";
import { attachBehavioralBaselines } from "../../src/snapshot/baselines.js";
import { assertSnapshotValid } from "../../src/snapshot/schema.js";
import type { Snapshot } from "../../src/snapshot/types.js";

const SNAPSHOT: Snapshot = {
  schemaVersion: "1",
  id: "snap_20260902_120000_000_deadbeef",
  timestamp: "2026-09-02T12:00:00.000Z",
  manifestHash: `sha256:${"0".repeat(64)}`,
  artifacts: {},
  metadata: {
    cliVersion: "0.0.0",
    nodeVersion: "v22.12.0",
    os: "linux-x64",
  },
};

function evalResult(output = "mock:eval-output"): PlanRunResult {
  return {
    suitePath: "/project/evals",
    providerId: "mock",
    startedAt: "2026-09-02T12:00:01.000Z",
    completedAt: "2026-09-02T12:00:02.000Z",
    durationMs: 1_000,
    dryRun: false,
    requestedSamples: 2,
    significanceLevel: 0.05,
    totalCostUsd: 0,
    unknownCostSamples: 0,
    executionTarget: {
      type: "provider",
      providerId: "mock",
      modelName: "primary",
      model: "mock-v1",
      promptNames: ["system"],
    },
    results: [
      {
        assertionId: "greeting",
        type: "contains",
        status: "NEW",
        score: 1,
        providerId: "mock",
        latencyMs: 14,
        costUsd: 0,
        output,
        samples: [
          {
            sampleIndex: 0,
            score: 1,
            output,
            latencyMs: 14,
            costUsd: 0,
            explanation: "Expected content was present.",
            expected: "contains mock:",
            actual: output,
          },
          {
            sampleIndex: 1,
            score: 1,
            output,
            latencyMs: 15,
            costUsd: 0,
            explanation: "Expected content was present.",
            expected: "contains mock:",
            actual: output,
          },
        ],
        tags: ["smoke"],
        critical: true,
        explanation: "Expected content was present.",
      },
    ],
    summary: { total: 1, passed: 0, warned: 0, failed: 0, new: 1, regressions: 0 },
    hasRegressions: false,
  };
}

function probeResult(output = "mock:probe-output", score = 1): ProbeRunResult {
  return {
    providerId: "mock",
    startedAt: "2026-09-02T12:00:01.000Z",
    completedAt: "2026-09-02T12:00:02.000Z",
    durationMs: 1_000,
    requestedSamples: 2,
    totalCostUsd: 0,
    unknownCostSamples: 0,
    results: [
      {
        modelName: "primary",
        provider: "mock",
        model: "mock-v1",
        probeId: "deterministic_math",
        category: "deterministic",
        status: "NEW",
        score,
        confidence: 1,
        explanation: "No baseline exists.",
        samples: [
          { output, latencyMs: 12, costUsd: 0, cached: false },
          { output, latencyMs: 13, costUsd: 0, cached: false },
        ],
      },
    ],
    summary: {
      total: 1,
      passed: 0,
      warned: 0,
      drifted: 0,
      insufficient: 0,
      errors: 0,
      new: 1,
    },
    hasDrift: false,
  };
}

describe("behavioral snapshot baselines", () => {
  it("persists complete eval and probe evidence tied to the snapshot", () => {
    const result = attachBehavioralBaselines({
      snapshot: SNAPSHOT,
      evalResult: evalResult(),
      probeResult: probeResult(),
    });

    expect(result.eval?.baselines?.greeting).toEqual({
      score: 1,
      providerId: "mock",
      modelName: "primary",
      model: "mock-v1",
      promptNames: ["system"],
      samples: [
        { output: "mock:eval-output", score: 1, latencyMs: 14, costUsd: 0 },
        { output: "mock:eval-output", score: 1, latencyMs: 15, costUsd: 0 },
      ],
      capturedAt: SNAPSHOT.timestamp,
      snapshotId: SNAPSHOT.id,
    });
    expect(result.probe?.baselines?.["primary/deterministic_math"]).toEqual({
      output: "mock:probe-output",
      score: 1,
      provider: "mock",
      model: "mock-v1",
      modelName: "primary",
      probeId: "deterministic_math",
      samples: [
        { output: "mock:probe-output", latencyMs: 12, costUsd: 0 },
        { output: "mock:probe-output", latencyMs: 13, costUsd: 0 },
      ],
      capturedAt: SNAPSHOT.timestamp,
      snapshotId: SNAPSHOT.id,
    });
    expect(assertSnapshotValid(result, "memory")).toBe(result);
  });

  it("rejects secret-like eval and probe evidence", () => {
    expect(() =>
      attachBehavioralBaselines({ snapshot: SNAPSHOT, evalResult: evalResult("sk-secretvalue") }),
    ).toThrow(expect.objectContaining({ code: "snapshot.baseline.invalid", exitCode: 2 }));

    const secretInLaterSample = evalResult();
    expect(() =>
      attachBehavioralBaselines({
        snapshot: SNAPSHOT,
        evalResult: {
          ...secretInLaterSample,
          results: [
            {
              ...secretInLaterSample.results[0]!,
              samples: secretInLaterSample.results[0]!.samples.map((sample, index) =>
                index === 1 ? { ...sample, output: "Bearer abcdefghijklmnop" } : sample,
              ),
            },
          ],
        },
      }),
    ).toThrow(expect.objectContaining({ code: "snapshot.baseline.invalid", exitCode: 2 }));

    expect(() =>
      attachBehavioralBaselines({
        snapshot: SNAPSHOT,
        probeResult: probeResult("Bearer abcdefghijklmnop"),
      }),
    ).toThrow(expect.objectContaining({ code: "snapshot.baseline.invalid", exitCode: 2 }));
  });

  it("persists the computed probe score and leaves unknown sample cost absent", () => {
    const source = probeResult("mock:probe-output", 0.5);
    const withoutCost: ProbeRunResult = {
      ...source,
      results: [
        {
          ...source.results[0]!,
          samples: source.results[0]!.samples.map(({ costUsd: _costUsd, ...sample }) => sample),
        },
      ],
    };
    const result = attachBehavioralBaselines({ snapshot: SNAPSHOT, probeResult: withoutCost });
    const baseline = result.probe?.baselines?.["primary/deterministic_math"];

    expect(baseline?.score).toBe(0.5);
    expect(baseline?.samples?.every((sample) => sample.costUsd === undefined)).toBe(true);
    expect(assertSnapshotValid(result, "memory")).toBe(result);
  });

  it("rejects probe results without evidence samples", () => {
    const emptyEvalResult = evalResult();
    expect(() =>
      attachBehavioralBaselines({
        snapshot: SNAPSHOT,
        evalResult: {
          ...emptyEvalResult,
          results: [{ ...emptyEvalResult.results[0]!, samples: [] }],
        },
      }),
    ).toThrow(expect.objectContaining({ code: "snapshot.baseline.invalid", exitCode: 2 }));

    const emptyResult: ProbeRunResult = {
      ...probeResult(),
      results: [{ ...probeResult().results[0]!, samples: [] }],
    };

    expect(() =>
      attachBehavioralBaselines({ snapshot: SNAPSHOT, probeResult: emptyResult }),
    ).toThrow(expect.objectContaining({ code: "snapshot.baseline.invalid", exitCode: 2 }));
  });
});
