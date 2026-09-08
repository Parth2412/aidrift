import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runEvalPlan } from "../../src/eval/runner.js";
import { createMockProvider } from "../../src/providers/mock-provider.js";

describe("mock provider", () => {
  it("returns deterministic output for the same input across instances", async () => {
    const first = createMockProvider();
    const second = createMockProvider();

    await expect(first.generate({ input: "hello" })).resolves.toEqual(
      await second.generate({ input: "hello" }),
    );
  });

  it("changes execution output when prompt, model, or model parameters change", async () => {
    const base = createMockProvider({
      model: "mock-v1",
      parameters: { temperature: 0 },
      systemPrompt: "POLICY_A",
    });
    const changedPrompt = createMockProvider({
      model: "mock-v1",
      parameters: { temperature: 0 },
      systemPrompt: "POLICY_B",
    });
    const changedModel = createMockProvider({
      model: "mock-v2",
      parameters: { temperature: 0 },
      systemPrompt: "POLICY_A",
    });
    const changedParameters = createMockProvider({
      model: "mock-v1",
      parameters: { temperature: 1 },
      systemPrompt: "POLICY_A",
    });

    const outputs = await Promise.all(
      [base, changedPrompt, changedModel, changedParameters].map(async (provider) =>
        provider.generate({ input: "hello" }),
      ),
    );

    expect(new Set(outputs.map((output) => output.content)).size).toBe(4);
    expect(outputs[0]?.content).toContain("POLICY_A");
    expect(outputs[1]?.content).toContain("POLICY_B");
  });
});

describe("eval runner", () => {
  let tmpDir: string;
  let suiteDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-runner-"));
    suiteDir = path.join(tmpDir, "evals");
    await fs.mkdir(suiteDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects secret-like provider output before returning or persisting evidence", async () => {
    await writeSuite(`
suite: secret-output
assertions:
  - id: secret
    type: contains
    input: "alpha"
    expected_contains: ["npm_"]
`);

    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        samples: 1,
        provider: {
          id: "leaky",
          generate: async () => ({
            content: "npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
            latencyMs: 1,
          }),
        },
      }),
    ).rejects.toMatchObject({ code: "eval.output.secret_detected", exitCode: 2 });
  });

  it("rejects malformed or oversized custom-provider output", async () => {
    await writeSuite(`
suite: invalid-provider-output
assertions:
  - id: invalid
    type: contains
    input: "alpha"
    expected_contains: ["pass"]
`);

    for (const generated of [
      { content: "pass", latencyMs: -1 },
      { content: "x".repeat(5 * 1024 * 1024 + 1), latencyMs: 1 },
    ]) {
      await expect(
        runEvalPlan({
          projectRoot: tmpDir,
          suitePath: suiteDir,
          samples: 1,
          provider: { id: "invalid", generate: async () => generated },
        }),
      ).rejects.toMatchObject({ code: "eval.output.invalid", exitCode: 2 });
    }
  });

  it("classifies PASS, WARN, FAIL, and NEW and sorts output by assertion id", async () => {
    await writeSuite(`
suite: runner
assertions:
  - id: z_new
    type: contains
    input: "alpha"
    expected_contains: ["mock:"]
  - id: a_pass
    type: contains
    input: "alpha"
    expected_contains: ["mock:"]
  - id: b_warn
    type: contains
    input: "alpha"
    expected_contains: ["missing"]
  - id: c_fail
    type: contains
    input: "alpha"
    critical: true
    expected_contains: ["missing"]
`);
    await writeSnapshot({
      a_pass: { score: 1, capturedAt: "2026-04-30T00:00:00.000Z" },
      b_warn: { score: 0.5, capturedAt: "2026-04-30T00:00:00.000Z" },
      c_fail: { score: 1, capturedAt: "2026-04-30T00:00:00.000Z" },
    });

    const result = await runEvalPlan({
      projectRoot: tmpDir,
      suitePath: suiteDir,
      allowRegressionIds: new Set(),
      concurrency: 2,
      dryRun: false,
      provider: createMockProvider(),
    });

    expect(result.results.map((item) => item.assertionId)).toEqual([
      "a_pass",
      "b_warn",
      "c_fail",
      "z_new",
    ]);
    expect(result.results.map((item) => item.status)).toEqual(["PASS", "WARN", "FAIL", "NEW"]);
    expect(result.summary).toMatchObject({ passed: 1, warned: 1, failed: 1, new: 1 });
    expect(result.results[2]?.statistics).toMatchObject({
      method: "fisher_exact",
      sampleCount: 5,
      baselineSampleCount: 5,
      significant: true,
    });
    expect(result.hasRegressions).toBe(true);
  });

  it("downgrades allowed regressions from FAIL to WARN", async () => {
    await writeSuite(`
suite: runner
assertions:
  - id: critical_regression
    type: contains
    input: "alpha"
    critical: true
    expected_contains: ["missing"]
`);
    await writeSnapshot({
      critical_regression: { score: 1, capturedAt: "2026-04-30T00:00:00.000Z" },
    });

    const result = await runEvalPlan({
      projectRoot: tmpDir,
      suitePath: suiteDir,
      allowRegressionIds: new Set(["critical_regression"]),
      dryRun: false,
      provider: createMockProvider(),
    });

    expect(result.results[0]?.status).toBe("WARN");
    expect(result.results[0]?.allowedRegression).toBe(true);
    expect(result.hasRegressions).toBe(false);
  });

  it("dry-run reports assertions without invoking the provider", async () => {
    await writeSuite(`
suite: runner
assertions:
  - id: dry
    type: regex
    input: "alpha"
    pattern: "anything"
`);

    const result = await runEvalPlan({
      projectRoot: tmpDir,
      suitePath: suiteDir,
      dryRun: true,
      provider: {
        id: "never",
        generate: async () => {
          throw new Error("provider should not run in dry-run");
        },
      },
    });

    expect(result.dryRun).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("NEW");
  });

  it("executes the requested samples and records per-sample evidence and observed cost", async () => {
    await writeSuite(`
suite: samples
assertions:
  - id: sampled
    type: contains
    input: "alpha"
    expected_contains: ["pass"]
`);
    let calls = 0;

    const result = await runEvalPlan({
      projectRoot: tmpDir,
      suitePath: suiteDir,
      samples: 3,
      provider: {
        id: "metered",
        generate: async () => {
          calls += 1;
          return { content: "pass", latencyMs: 12, costUsd: 0.01 };
        },
      },
    });

    expect(calls).toBe(3);
    expect(result.requestedSamples).toBe(3);
    expect(result.totalCostUsd).toBeCloseTo(0.03, 8);
    expect(result.unknownCostSamples).toBe(0);
    expect(result.results[0]?.samples).toHaveLength(3);
    expect(result.results[0]?.samples.map((sample) => sample.sampleIndex)).toEqual([0, 1, 2]);
  });

  it("filters by assertion id and tags and rejects selections that match nothing", async () => {
    await writeSuite(`
suite: selection
assertions:
  - id: safety
    type: contains
    input: "alpha"
    tags: [safety]
    expected_contains: ["mock:"]
  - id: quality
    type: contains
    input: "alpha"
    tags: [quality]
    expected_contains: ["mock:"]
`);

    const filtered = await runEvalPlan({
      projectRoot: tmpDir,
      suitePath: suiteDir,
      assertionIds: new Set(["safety"]),
      tags: new Set(["safety"]),
      samples: 1,
    });
    expect(filtered.results.map((result) => result.assertionId)).toEqual(["safety"]);

    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        assertionIds: new Set(["unknown"]),
      }),
    ).rejects.toMatchObject({ code: "eval.config.invalid", exitCode: 2 });
    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        allowRegressionIds: new Set(["unknown"]),
      }),
    ).rejects.toMatchObject({ code: "eval.config.invalid", exitCode: 2 });
    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        tags: new Set(["missing"]),
      }),
    ).rejects.toMatchObject({ code: "eval.config.invalid", exitCode: 2 });
    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        assertionIds: new Set(),
      }),
    ).rejects.toMatchObject({ code: "eval.config.invalid", exitCode: 2 });
  });

  it("rejects an invalid custom-provider identity", async () => {
    await writeSuite(`
suite: provider-identity
assertions:
  - id: valid
    type: contains
    input: "alpha"
    expected_contains: ["pass"]
`);
    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        provider: { id: "\n", generate: async () => ({ content: "pass", latencyMs: 1 }) },
      }),
    ).rejects.toMatchObject({ code: "eval.config.invalid", exitCode: 2 });
  });

  it("keeps a critical degradation at WARN when the sampled evidence is not significant", async () => {
    await writeSuite(`
suite: significance
assertions:
  - id: critical
    type: contains
    input: "alpha"
    critical: true
    expected_contains: ["missing"]
`);
    await writeSnapshot({
      critical: {
        score: 1,
        scores: [1],
        capturedAt: "2026-04-30T00:00:00.000Z",
      },
    });

    const result = await runEvalPlan({
      projectRoot: tmpDir,
      suitePath: suiteDir,
      samples: 1,
    });

    expect(result.results[0]?.status).toBe("WARN");
    expect(result.results[0]?.statistics).toMatchObject({
      pValue: 0.5,
      significanceLevel: 0.05,
      significant: false,
    });
  });

  it("aborts the whole eval run at its configured deadline", async () => {
    await writeSuite(`
suite: timeout
assertions:
  - id: slow
    type: contains
    input: "alpha"
    expected_contains: ["pass"]
`);

    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        timeoutMs: 5,
        provider: {
          id: "slow",
          generate: async () => new Promise(() => undefined),
        },
      }),
    ).rejects.toMatchObject({ code: "eval.timeout", exitCode: 2 });
  });

  it("enforces observed budgets and fails closed when sample cost is unknown", async () => {
    await writeSuite(`
suite: budget
assertions:
  - id: costly
    type: contains
    input: "alpha"
    expected_contains: ["pass"]
`);

    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        samples: 1,
        budgetUsd: 0.01,
        provider: {
          id: "costly",
          generate: async () => ({ content: "pass", latencyMs: 1, costUsd: 0.02 }),
        },
      }),
    ).rejects.toMatchObject({ code: "eval.budget.exceeded", exitCode: 2 });

    await expect(
      runEvalPlan({
        projectRoot: tmpDir,
        suitePath: suiteDir,
        samples: 1,
        budgetUsd: 1,
        provider: {
          id: "unknown-cost",
          generate: async () => ({ content: "pass", latencyMs: 1 }),
        },
      }),
    ).rejects.toMatchObject({ code: "eval.cost.unknown", exitCode: 2 });
  });

  it("rejects invalid numeric run controls", async () => {
    await writeSuite(`
suite: invalid-controls
assertions:
  - id: alpha
    type: contains
    input: "alpha"
    expected_contains: ["mock:"]
`);

    for (const options of [
      { samples: 0 },
      { samples: 101 },
      { timeoutMs: 0 },
      { timeoutMs: 3_600_001 },
      { concurrency: 0 },
      { concurrency: 33, budgetUsd: 1 },
      { significanceLevel: 1 },
      { budgetUsd: -1 },
    ]) {
      await expect(
        runEvalPlan({ projectRoot: tmpDir, suitePath: suiteDir, ...options }),
      ).rejects.toMatchObject({ code: "eval.config.invalid", exitCode: 2 });
    }
  });

  async function writeSuite(source: string): Promise<void> {
    await fs.writeFile(path.join(suiteDir, "basic.assertions.yml"), source, "utf8");
  }

  async function writeSnapshot(
    baselines: Record<
      string,
      {
        readonly score: number;
        readonly scores?: readonly number[];
        readonly capturedAt: string;
      }
    >,
  ): Promise<void> {
    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    await fs.writeFile(
      path.join(snapshotsDir, "snap_20260430_000000.json"),
      JSON.stringify({
        schemaVersion: "1",
        id: "snap_20260430_000000",
        timestamp: "2026-04-30T00:00:00.000Z",
        manifestHash: `sha256:${"0".repeat(64)}`,
        artifacts: {},
        eval: {
          baselines: Object.fromEntries(
            Object.entries(baselines).map(([id, baseline]) => [
              id,
              {
                score: baseline.score,
                capturedAt: baseline.capturedAt,
                samples: (
                  baseline.scores ??
                  (baseline.score === 0.5 ? [1, 0] : Array(5).fill(baseline.score))
                ).map((score) => ({ output: "baseline", score, latencyMs: 1, costUsd: 0 })),
              },
            ]),
          ),
        },
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
