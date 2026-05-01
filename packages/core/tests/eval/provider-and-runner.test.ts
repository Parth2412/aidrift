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

  async function writeSuite(source: string): Promise<void> {
    await fs.writeFile(path.join(suiteDir, "basic.assertions.yml"), source, "utf8");
  }

  async function writeSnapshot(
    baselines: Record<string, { readonly score: number; readonly capturedAt: string }>,
  ): Promise<void> {
    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    await fs.writeFile(
      path.join(snapshotsDir, "snap_20260430_000000.json"),
      JSON.stringify({
        schemaVersion: "1",
        id: "snap_20260430_000000",
        timestamp: "2026-04-30T00:00:00.000Z",
        manifestHash: "sha256:test",
        artifacts: {},
        eval: { baselines },
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
