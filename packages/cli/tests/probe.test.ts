import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/runner.js";

const MANIFEST = `
version: "1"
name: probe-test
artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o-2024-08-06
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`;

describe("aidrift probe", () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-cli-probe-"));
    manifestPath = path.join(tmpDir, ".aistate.yml");
    await fs.writeFile(manifestPath, MANIFEST, "utf8");
    await fs.mkdir(path.join(tmpDir, "evals"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("prints help for probe", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "probe", "--help"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("--estimate-cost");
    expect(test.stdout).toContain("--category");
    expect(test.stdout).toContain("--timeout");
  });

  it("--estimate-cost exits 0 without running probes", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "probe", "--estimate-cost"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Estimated requests: 100");
    expect(test.stdout).toContain("Estimated input tokens:");
    expect(test.stdout).toContain("Pricing verified: 2026-09-08");
    expect(test.stdout).toContain("Estimated cost: $0.000000");
    expect(test.stderr).toBe("");
  });

  it("--estimate-cost --format json emits one machine-readable document", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "probe", "--estimate-cost", "--format", "json"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(test.stdout)).toMatchObject({
      schemaVersion: "cost-estimate.v1",
      modelCount: 1,
      probeCount: 20,
      samples: 5,
      requestCount: 100,
      costEstimateKnown: true,
      pricingAsOf: "2026-09-08",
    });
    expect(test.stderr).toBe("");
  });

  it("rejects malformed numeric options", async () => {
    for (const args of [
      ["--samples", "5oops"],
      ["--samples", "101"],
      ["--concurrency", "33"],
      ["--cache-ttl", "43201"],
      ["--timeout", "3601"],
    ]) {
      const test = createTestIo();
      const exitCode = await runCli(
        ["node", "aidrift", "--config", manifestPath, "probe", ...args],
        test.io,
      );

      expect(exitCode).toBe(2);
      expect(test.stderr).toContain("Code: probe.option.invalid");
    }
  });

  it("rejects an unsupported output format before live provider execution", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "probe",
        "--provider",
        "openai",
        "--format",
        "html",
        "--yes",
      ],
      { ...test.io, env: { AIDRIFT_OPENAI_API_KEY: "test-key-that-must-not-be-used" } },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("probe.format.unsupported");
    expect(test.stdout).toBe("");
  });

  it("reports unknown live prices without fabricating a dollar estimate", async () => {
    await fs.writeFile(
      manifestPath,
      MANIFEST.replace("gpt-4o-2024-08-06", "gpt-future-2099"),
      "utf8",
    );
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "probe",
        "--provider",
        "openai",
        "--estimate-cost",
      ],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Estimated cost: unknown");
    expect(test.stdout).toContain("gpt-future-2099");
  });

  it("runs mocked probes and emits stable JSON", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "probe",
        "--category",
        "deterministic",
        "--samples",
        "1",
        "--format",
        "json",
        "--no-cache",
      ],
      test.io,
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(test.stdout) as {
      readonly providerId: string;
      readonly requestedSamples: number;
      readonly totalCostUsd: number;
      readonly unknownCostSamples: number;
      readonly summary: { readonly total: number; readonly new: number };
      readonly results: readonly { readonly probeId: string; readonly status: string }[];
    };
    expect(parsed.summary).toMatchObject({ total: 4, new: 4 });
    expect(parsed).toMatchObject({
      providerId: "mock",
      requestedSamples: 1,
      totalCostUsd: 0,
      unknownCostSamples: 0,
    });
    expect(parsed.results.map((item) => item.probeId)).toEqual([
      "deterministic_code",
      "deterministic_fact",
      "deterministic_math",
      "deterministic_sort",
    ]);
    expect(parsed.results.every((item) => item.status === "NEW")).toBe(true);
    expect(test.stderr).toBe("");
  });

  it("missing manifest exits 2 with the standardized error envelope", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", path.join(tmpDir, "missing.yml"), "probe"],
      test.io,
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("Error:");
    expect(test.stderr).toContain("Code: manifest.file.missing");
  });

  it("--provider mock runs without requiring any env var", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "probe",
        "--provider",
        "mock",
        "--category",
        "deterministic",
        "--samples",
        "1",
        "--format",
        "json",
        "--no-cache",
      ],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(0);
    expect(test.stderr).toBe("");
  });

  it("--provider openai exits 2 when AIDRIFT_OPENAI_API_KEY is missing", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "probe",
        "--provider",
        "openai",
        "--category",
        "deterministic",
        "--samples",
        "1",
        "--no-cache",
      ],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("OPENAI_API_KEY");
    expect(test.stderr).toContain("https://github.com/Parth2412/aidrift#readme");
    expect(test.stderr).toContain("Code: probe.provider.auth_missing");
  });

  it("keeps live-run cost notices off JSON stdout", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "probe",
        "--provider",
        "openai",
        "--format",
        "json",
      ],
      { ...test.io, env: { AIDRIFT_OPENAI_API_KEY: "test-key-that-must-not-be-used" } },
    );

    expect(exitCode).toBe(2);
    expect(test.stdout).toBe("");
    expect(test.stderr).toContain("AIDRIFT Probe Cost Estimate");
    expect(test.stderr).toContain("Code: probe.confirmation.required");
  });

  it("--provider anthropic exits 2 when AIDRIFT_ANTHROPIC_API_KEY is missing", async () => {
    const test = createTestIo();
    await fs.writeFile(
      manifestPath,
      MANIFEST.replace("provider: openai", "provider: anthropic").replace(
        "model: gpt-4o-2024-08-06",
        "model: claude-haiku-4-5-20251001",
      ),
      "utf8",
    );

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "probe",
        "--provider",
        "anthropic",
        "--category",
        "deterministic",
        "--samples",
        "1",
        "--no-cache",
      ],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("ANTHROPIC_API_KEY");
    expect(test.stderr).toContain("https://github.com/Parth2412/aidrift#readme");
    expect(test.stderr).toContain("Code: probe.provider.auth_missing");
  });

  it("--provider invalid exits 2 with a helpful message", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "probe", "--provider", "bogus"],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("must be one of mock, openai, anthropic");
  });
});

function createTestIo() {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
        },
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}
