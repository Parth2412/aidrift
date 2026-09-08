import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUILT_IN_PROBES,
  estimateProbeCost,
  runProviderProbes,
  type ProbeBaselineMap,
} from "../../src/probe/index.js";
import { createMockProvider } from "../../src/providers/mock-provider.js";

describe("built-in provider probes", () => {
  it("ships 20 canonical probes across the five drift categories", () => {
    expect(BUILT_IN_PROBES).toHaveLength(20);
    expect(new Set(BUILT_IN_PROBES.map((probe) => probe.id)).size).toBe(20);
    expect(new Set(BUILT_IN_PROBES.map((probe) => probe.category))).toEqual(
      new Set(["deterministic", "structural", "semantic", "behavioral", "performance"]),
    );
  });
});

describe("probe runner", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-probe-runner-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("classifies probes against latest snapshot baselines and keeps stable sorted output", async () => {
    const provider = createMockProvider();
    const deterministic = BUILT_IN_PROBES.find((probe) => probe.id === "deterministic_math");
    const structural = BUILT_IN_PROBES.find((probe) => probe.id === "structural_json_object");
    expect(deterministic).toBeDefined();
    expect(structural).toBeDefined();

    const deterministicOutput = await provider.generate({
      input: deterministic?.input ?? "",
      probeId: deterministic?.id,
      modelName: "primary",
    });
    await writeProbeSnapshot({
      "primary/deterministic_math": {
        output: deterministicOutput.content,
        score: 1,
        provider: "mock",
        model: "mock-stable",
        modelName: "primary",
        probeId: "deterministic_math",
        samples: Array.from({ length: 5 }, () => ({
          output: deterministicOutput.content,
          latencyMs: 10,
        })),
        capturedAt: "2026-05-01T00:00:00.000Z",
        snapshotId: "snap_20260501_000000",
      },
      "primary/structural_json_object": {
        output: '{"name":"baseline","status":"ok"}',
        score: 1,
        provider: "mock",
        model: "mock-stable",
        modelName: "primary",
        probeId: "structural_json_object",
        samples: Array.from({ length: 5 }, () => ({
          output: '{"name":"baseline","status":"ok"}',
          latencyMs: 10,
        })),
        capturedAt: "2026-05-01T00:00:00.000Z",
        snapshotId: "snap_20260501_000000",
      },
    });

    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-stable" }],
      provider,
      probeIds: new Set(["structural_json_object", "deterministic_math"]),
      samples: 5,
      cacheTtlMinutes: 0,
    });

    expect(result.baselineSnapshotId).toBe("snap_20260501_000000");
    expect(result.results.map((item) => `${item.modelName}/${item.probeId}`)).toEqual([
      "primary/deterministic_math",
      "primary/structural_json_object",
    ]);
    expect(result.results.map((item) => item.status)).toEqual(["PASS", "DRIFT"]);
    expect(result.summary).toMatchObject({ total: 2, passed: 1, drifted: 1, errors: 0, new: 0 });
    expect(result.hasDrift).toBe(true);
  });

  it("reuses cached probe samples within the configured TTL", async () => {
    let calls = 0;

    await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-stable" }],
      provider: {
        id: "counting",
        async generate(request) {
          calls += 1;
          return {
            content: `counting:${request.input}`,
            latencyMs: 5,
          };
        },
      },
      allowProviderOverride: true,
      probeIds: new Set(["deterministic_math"]),
      samples: 3,
      cacheTtlMinutes: 60,
    });

    await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-stable" }],
      provider: {
        id: "counting",
        async generate(request) {
          calls += 1;
          return {
            content: `counting:${request.input}`,
            latencyMs: 5,
          };
        },
      },
      allowProviderOverride: true,
      probeIds: new Set(["deterministic_math"]),
      samples: 3,
      cacheTtlMinutes: 60,
    });

    expect(calls).toBe(3);
  });

  it("rejects secret-like provider output before writing the probe cache", async () => {
    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-stable" }],
      provider: {
        id: "mock",
        async generate() {
          return { content: "sk-secretvalue123456789", latencyMs: 1 };
        },
      },
      probeIds: new Set(["deterministic_math"]),
      samples: 1,
      cacheTtlMinutes: 60,
    });

    expect(result.summary.errors).toBe(1);
    expect(result.results[0]?.explanation).toContain("Secret-like provider output detected");
    await expect(fs.access(path.join(tmpDir, ".aidrift", "cache"))).rejects.toThrow();
  });

  it("marks oversized custom-provider output as an execution error", async () => {
    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-stable" }],
      provider: {
        id: "mock",
        async generate() {
          return { content: "x".repeat(5 * 1024 * 1024 + 1), latencyMs: 1 };
        },
      },
      probeIds: new Set(["deterministic_math"]),
      samples: 1,
      cacheTtlMinutes: 0,
    });

    expect(result.summary.errors).toBe(1);
    expect(result.results[0]?.explanation).toContain("provider output exceeds");
  });

  it("routes each model through its own provider instance", async () => {
    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [
        { name: "first", provider: "openai", model: "model-a" },
        { name: "second", provider: "openai", model: "model-b" },
      ],
      providerForModel: (model) => ({
        id: `provider-${model.model}`,
        async generate(request) {
          return {
            content: `${model.model}:${request.input}`,
            latencyMs: 5,
          };
        },
      }),
      allowProviderOverride: true,
      probeIds: new Set(["deterministic_math"]),
      samples: 1,
      cacheTtlMinutes: 0,
    });

    expect(result.providerId).toBe("multiple");
    expect(result.results[0]?.samples[0]?.output).toContain("model-a:");
    expect(result.results[1]?.samples[0]?.output).toContain("model-b:");
  });

  it("does not reuse cache entries after the model id changes under the same alias", async () => {
    let calls = 0;
    const provider = {
      id: "counting",
      async generate(request: { readonly input: string }) {
        calls += 1;
        return { content: request.input, latencyMs: 5 };
      },
    };

    for (const model of ["model-v1", "model-v2"]) {
      await runProviderProbes({
        projectRoot: tmpDir,
        models: [{ name: "primary", provider: "mock", model }],
        provider,
        allowProviderOverride: true,
        probeIds: new Set(["deterministic_math"]),
        samples: 1,
        cacheTtlMinutes: 60,
      });
    }

    expect(calls).toBe(2);
  });

  it("uses every requested sample when classifying a regression", async () => {
    await writeProbeSnapshot({
      "primary/deterministic_math": {
        output: "42",
        score: 1,
        provider: "mock",
        model: "mock-v1",
        modelName: "primary",
        probeId: "deterministic_math",
        samples: Array.from({ length: 5 }, () => ({ output: "42", latencyMs: 10 })),
        capturedAt: "2026-05-01T00:00:00.000Z",
      },
    });
    let calls = 0;
    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-v1" }],
      provider: {
        id: "mock",
        async generate() {
          calls += 1;
          return { content: calls === 1 ? "42" : "41", latencyMs: 10 };
        },
      },
      probeIds: new Set(["deterministic_math"]),
      samples: 5,
      cacheTtlMinutes: 0,
    });

    expect(calls).toBe(5);
    expect(result.results[0]).toMatchObject({ status: "DRIFT", score: 0.2 });
    expect(result.results[0]?.samples).toHaveLength(5);
    expect(result.results[0]?.samples[0]?.costUsd).toBeUndefined();
  });

  it("fails closed when an executor or baseline identity is unverifiable", async () => {
    await expect(
      runProviderProbes({
        projectRoot: tmpDir,
        models: [{ name: "primary", provider: "openai", model: "gpt-4o" }],
        probeIds: new Set(["deterministic_math"]),
      }),
    ).rejects.toThrow("No provider executor was supplied");

    await writeProbeSnapshot({
      "primary/deterministic_math": {
        output: "42",
        score: 1,
        provider: "openai",
        model: "gpt-4o",
        modelName: "primary",
        probeId: "deterministic_math",
        samples: Array.from({ length: 5 }, () => ({ output: "42", latencyMs: 10 })),
        capturedAt: "2026-05-01T00:00:00.000Z",
      },
    });
    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-v1" }],
      probeIds: new Set(["deterministic_math"]),
      samples: 5,
    });

    expect(result.summary.errors).toBe(1);
    expect(result.results[0]?.explanation).toContain("Baseline identity mismatch");
  });

  it("enforces a total probe deadline and exposes bounded-run evidence", async () => {
    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-v1" }],
      provider: {
        id: "mock",
        async generate() {
          return new Promise<never>(() => undefined);
        },
      },
      probeIds: new Set(["deterministic_math"]),
      samples: 3,
      timeoutMs: 10,
      cacheTtlMinutes: 0,
    });

    expect(result.summary.errors).toBe(1);
    expect(result.results[0]?.explanation).toContain("configured timeout");
    expect(result.requestedSamples).toBe(3);
    expect(result.totalCostUsd).toBe(0);
    expect(result.unknownCostSamples).toBe(0);
  });

  it("rejects probe controls above the operational ceilings", async () => {
    const base = {
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-v1" }],
      probeIds: new Set(["deterministic_math"]),
    };
    for (const override of [
      { samples: 101 },
      { concurrency: 33 },
      { timeoutMs: 3_600_001 },
      { cacheTtlMinutes: 43_201 },
    ]) {
      await expect(runProviderProbes({ ...base, ...override })).rejects.toMatchObject({
        code: "probe.option.invalid",
        exitCode: 2,
      });
    }
  });

  it("rejects cyclic model parameters and invalid executor identities", async () => {
    const parameters: Record<string, unknown> = {};
    parameters.self = parameters;
    await expect(
      runProviderProbes({
        projectRoot: tmpDir,
        models: [{ name: "primary", provider: "mock", model: "mock-v1", parameters }],
        probeIds: new Set(["deterministic_math"]),
      }),
    ).rejects.toMatchObject({ code: "probe.model.invalid", exitCode: 2 });

    await expect(
      runProviderProbes({
        projectRoot: tmpDir,
        models: [{ name: "primary", provider: "mock", model: "mock-v1" }],
        provider: {
          id: "\n",
          generate: async () => ({ content: "42", latencyMs: 1 }),
        },
        allowProviderOverride: true,
        probeIds: new Set(["deterministic_math"]),
      }),
    ).rejects.toMatchObject({ code: "probe.provider.executor_invalid", exitCode: 2 });
  });

  it("stops spending when observed probe cost exceeds its budget", async () => {
    let calls = 0;
    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-v1" }],
      provider: {
        id: "mock",
        async generate() {
          calls += 1;
          return { content: "42", latencyMs: 1, costUsd: 0.6 };
        },
      },
      probeIds: new Set(["deterministic_math"]),
      samples: 3,
      budgetUsd: 1,
      cacheTtlMinutes: 0,
    });

    expect(calls).toBe(2);
    expect(result.summary.errors).toBe(1);
    expect(result.results[0]?.explanation).toContain("exceeded budget");
    expect(result.totalCostUsd).toBe(0.6);
  });

  it("estimates provider probe cost without invoking a provider", () => {
    const estimate = estimateProbeCost({
      models: [{ name: "primary", provider: "openai", model: "gpt-4o-2024-08-06" }],
      samples: 5,
    });

    expect(estimate.modelCount).toBe(1);
    expect(estimate.probeCount).toBe(20);
    expect(estimate.requestCount).toBe(100);
    expect(estimate.estimatedUsd).toBeGreaterThan(0);
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBeGreaterThan(estimate.estimatedInputTokens);
    expect(estimate.unknownModels).toEqual([]);
    expect(estimate.pricingAsOf).toBe("2026-09-08");
  });

  it("rejects estimates above the supported request ceiling", () => {
    expect(() =>
      estimateProbeCost({
        models: [{ name: "primary", provider: "openai", model: "gpt-4.1-mini-2025-04-14" }],
        samples: 100,
        probeCount: 1_001,
      }),
    ).toThrow(/100000 provider requests/u);
  });

  it("does not fabricate a cost for an unknown model", () => {
    const estimate = estimateProbeCost({
      models: [{ name: "future", provider: "openai", model: "gpt-future-2099" }],
      samples: 3,
      probeCount: 4,
    });

    expect(estimate.requestCount).toBe(12);
    expect(estimate.estimatedUsd).toBeUndefined();
    expect(estimate.unknownModels).toEqual(["future (openai/gpt-future-2099)"]);
  });

  it("applies long-context prices per estimated request", () => {
    const estimate = estimateProbeCost({
      models: [{ name: "primary", provider: "openai", model: "gpt-5.6-terra" }],
      samples: 2,
      requestInputs: ["short"],
      inputTokenOverheadPerRequest: 272_000,
      estimatedOutputTokensPerRequest: 1_000,
    });

    const inputTokensPerRequest = 272_026;
    expect(estimate.estimatedInputTokens).toBe(inputTokensPerRequest * 2);
    expect(estimate.estimatedOutputTokens).toBe(2_000);
    expect(estimate.estimatedUsd).toBeCloseTo(
      (inputTokensPerRequest * 2e-6 * 2 + 1_000 * 12e-6 * 1.5) * 2,
      6,
    );
  });

  async function writeProbeSnapshot(baselines: ProbeBaselineMap): Promise<void> {
    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    await fs.writeFile(
      path.join(snapshotsDir, "snap_20260501_000000.json"),
      JSON.stringify({
        schemaVersion: "1",
        id: "snap_20260501_000000",
        timestamp: "2026-05-01T00:00:00.000Z",
        manifestHash: `sha256:${"0".repeat(64)}`,
        artifacts: {},
        probe: { baselines },
        metadata: {
          cliVersion: "0.0.0",
          nodeVersion: "v22.0.0",
          os: "test",
        },
      }),
      "utf8",
    );
  }
});
