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
    const structuralOutput = await provider.generate({
      input: structural?.input ?? "",
      probeId: structural?.id,
      modelName: "primary",
    });

    await writeProbeSnapshot({
      "primary/deterministic_math": {
        output: deterministicOutput.content,
        score: 1,
        capturedAt: "2026-05-01T00:00:00.000Z",
        snapshotId: "snap_20260501_000000",
      },
      "primary/structural_json_object": {
        output: `${structuralOutput.content} changed`,
        score: 1,
        capturedAt: "2026-05-01T00:00:00.000Z",
        snapshotId: "snap_20260501_000000",
      },
    });

    const result = await runProviderProbes({
      projectRoot: tmpDir,
      models: [{ name: "primary", provider: "mock", model: "mock-stable" }],
      provider,
      probeIds: new Set(["structural_json_object", "deterministic_math"]),
      samples: 2,
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
      probeIds: new Set(["deterministic_math"]),
      samples: 3,
      cacheTtlMinutes: 60,
    });

    expect(calls).toBe(3);
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
        manifestHash: "sha256:test",
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
