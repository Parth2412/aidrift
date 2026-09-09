import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/runner.js";

const MANIFEST = `
version: "1"
name: plan-test
artifacts:
  models:
    primary:
      type: model
      provider: mock
      model: mock-v1
eval:
  suite: ./evals
  target:
    type: provider
    model: primary
storage:
  backend: local
  path: ./.aidrift/snapshots
`;

const PROMPT_MANIFEST = `
version: "1"
name: prompt-plan-test
artifacts:
  prompts:
    system:
      type: prompt
      path: ./system.txt
      format: text
  models:
    primary:
      type: model
      provider: mock
      model: mock-v1
      parameters:
        temperature: 0
eval:
  suite: ./evals
  samples_per_assertion: 5
  significance_level: 0.05
  target:
    type: provider
    model: primary
    prompts: [system]
storage:
  backend: local
  path: ./.aidrift/snapshots
`;

describe("aidrift plan", () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-cli-plan-"));
    manifestPath = path.join(tmpDir, ".aistate.yml");
    await fs.writeFile(manifestPath, MANIFEST, "utf8");
    await fs.mkdir(path.join(tmpDir, "evals"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("prints help for plan", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "plan", "--help"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("--dry-run");
    expect(test.stdout).toContain("--probe-providers");
  });

  it("dry-run exits 0 against a freshly initialized-style project with no assertion files", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "plan", "--dry-run"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Assertions: 0");
    expect(test.stderr).toBe("");
  });

  it("missing manifest exits 2 with the standardized error envelope", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", path.join(tmpDir, "missing.yml"), "plan"],
      test.io,
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("Error:");
    expect(test.stderr).toContain("Code: manifest.file.missing");
  });

  it("rejects run controls above the operational ceilings", async () => {
    for (const args of [
      ["--samples", "101"],
      ["--concurrency", "33"],
      ["--timeout", "3601"],
    ]) {
      const test = createTestIo();
      const exitCode = await runCli(
        ["node", "aidrift", "--config", manifestPath, "plan", ...args],
        test.io,
      );

      expect(exitCode).toBe(2);
      expect(test.stderr).toContain("Code: plan.option.invalid");
    }
  });

  it("regression fixture exits 1", async () => {
    await writeSuite(`
suite: regression
assertions:
  - id: must_pass
    type: contains
    input: "hello"
    critical: true
    expected_contains: ["missing"]
`);
    await writeSnapshot({ must_pass: { score: 1, capturedAt: "2026-04-30T00:00:00.000Z" } });
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "--config", manifestPath, "plan"], test.io);

    expect(exitCode).toBe(1);
    expect(test.stdout).toContain("must_pass");
    expect(test.stdout).toContain("FAIL");
  });

  it("turns an executed system-prompt change into a statistically justified regression", async () => {
    await fs.writeFile(manifestPath, PROMPT_MANIFEST, "utf8");
    await fs.writeFile(path.join(tmpDir, "system.txt"), "POLICY_VERSION_A", "utf8");
    await writeSuite(`
suite: prompt-regression
assertions:
  - id: preserves_policy
    type: contains
    input: "answer the request"
    critical: true
    expected_contains: ["POLICY_VERSION_A"]
`);
    const snapshot = createTestIo();

    const snapshotExitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "snapshot",
        "--with-evals",
        "--provider",
        "mock",
        "--samples",
        "5",
      ],
      { ...snapshot.io, env: {} },
    );
    expect(snapshotExitCode).toBe(0);

    await fs.writeFile(path.join(tmpDir, "system.txt"), "POLICY_VERSION_B", "utf8");
    const plan = createTestIo();
    const planExitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "plan", "--format", "json"],
      { ...plan.io, env: {} },
    );

    expect(planExitCode).toBe(1);
    const result = JSON.parse(plan.stdout) as {
      readonly results: readonly {
        readonly assertionId: string;
        readonly status: string;
        readonly score: number;
        readonly baselineScore: number;
        readonly statistics: {
          readonly method: string;
          readonly pValue: number;
          readonly significant: boolean;
        };
      }[];
    };
    expect(result.results[0]).toMatchObject({
      assertionId: "preserves_policy",
      status: "FAIL",
      score: 0,
      baselineScore: 1,
      statistics: {
        method: "fisher_exact",
        pValue: 0.003968,
        significant: true,
      },
    });
  });

  it("--probe-providers runs mocked provider probes", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "plan", "--probe-providers"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Provider probes: 20");
    expect(test.stderr).toBe("");
    await expect(fs.access(path.join(tmpDir, ".aidrift", "cache"))).rejects.toThrow();
  });

  it("--probe-providers --provider mock runs without env vars", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "plan",
        "--probe-providers",
        "--provider",
        "mock",
      ],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Provider probes: 20");
    expect(test.stderr).toBe("");
  });

  it("--probe-providers --provider chat-completions exits 2 when OPENAI_API_KEY is missing", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "plan",
        "--probe-providers",
        "--provider",
        "openai",
      ],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("OPENAI_API_KEY");
    expect(test.stderr).toContain("https://github.com/Parth2412/aidrift#readme");
    expect(test.stderr).toContain("Code: probe.provider.auth_missing");
  });

  it("keeps live cost notices off JSON stdout", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "plan",
        "--probe-providers",
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

  it("--probe-providers --provider messages-api exits 2 when ANTHROPIC_API_KEY is missing", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "plan",
        "--probe-providers",
        "--provider",
        "anthropic",
      ],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("ANTHROPIC_API_KEY");
    expect(test.stderr).toContain("https://github.com/Parth2412/aidrift#readme");
    expect(test.stderr).toContain("Code: probe.provider.auth_missing");
  });

  it("--probe-providers --provider invalid exits 2 with a helpful message", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        manifestPath,
        "plan",
        "--probe-providers",
        "--provider",
        "bogus",
      ],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("must be one of mock, openai, anthropic");
  });

  it("--format json emits stable valid JSON", async () => {
    await writeSuite(`
suite: json
assertions:
  - id: alpha
    type: contains
    input: "hello"
    expected_contains: ["mock:"]
`);
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "plan", "--format", "json"],
      test.io,
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(test.stdout) as {
      readonly results: readonly { readonly assertionId: string; readonly status: string }[];
    };
    expect(parsed.results).toEqual([{ assertionId: "alpha", status: "NEW", score: 1 }]);
    expect(test.stderr).toBe("");
  });

  it("--save writes result JSON to .aidrift/results", async () => {
    await writeSuite(`
suite: save
assertions:
  - id: save_me
    type: contains
    input: "hello"
    expected_contains: ["mock:"]
`);
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "plan", "--save"],
      test.io,
    );

    expect(exitCode).toBe(0);
    const files = await fs.readdir(path.join(tmpDir, ".aidrift", "results"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^plan_\d{8}_\d{6}_[0-9a-f]{8}\.json$/u);
    if (process.platform !== "win32") {
      const stat = await fs.stat(path.join(tmpDir, ".aidrift", "results", files[0]!));
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("--save includes requested provider-probe evidence", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "plan", "--probe-providers", "--save"],
      test.io,
    );

    expect(exitCode).toBe(0);
    const resultDir = path.join(tmpDir, ".aidrift", "results");
    const [filename] = await fs.readdir(resultDir);
    const saved = JSON.parse(await fs.readFile(path.join(resultDir, filename!), "utf8")) as {
      readonly probes?: { readonly summary: { readonly total: number } };
    };
    expect(saved.probes?.summary.total).toBe(20);
  });

  it("refuses secret-like assertion input before provider execution or persistence", async () => {
    await writeSuite(`
suite: secret-output
assertions:
  - id: unsafe
    type: contains
    input: "repeat sk-secretvalue123456789"
    expected_contains: ["mock:"]
`);
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "plan", "--save"],
      test.io,
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("assertion.secret.disallowed");
    await expect(fs.access(path.join(tmpDir, ".aidrift", "results"))).rejects.toThrow();
  });

  it.runIf(process.platform !== "win32")(
    "--save rejects a results directory that escapes through a symlink",
    async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-plan-outside-"));
      try {
        await writeSuite(`
suite: save
assertions:
  - id: save_me
    type: contains
    input: "hello"
    expected_contains: ["mock:"]
`);
        await fs.mkdir(path.join(tmpDir, ".aidrift"));
        await fs.symlink(outsideDir, path.join(tmpDir, ".aidrift", "results"), "dir");
        const test = createTestIo();

        const exitCode = await runCli(
          ["node", "aidrift", "--config", manifestPath, "plan", "--save"],
          test.io,
        );

        expect(exitCode).toBe(2);
        expect(test.stderr).toContain("path.symlink_escape");
        expect(await fs.readdir(outsideDir)).toEqual([]);
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    },
  );

  async function writeSuite(source: string): Promise<void> {
    await fs.writeFile(path.join(tmpDir, "evals", "basic.assertions.yml"), source, "utf8");
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
        manifestHash: `sha256:${"0".repeat(64)}`,
        artifacts: {},
        eval: {
          baselines: Object.fromEntries(
            Object.entries(baselines).map(([assertionId, baseline]) => [
              assertionId,
              {
                ...baseline,
                samples: Array.from({ length: 5 }, () => ({
                  output: "baseline output",
                  score: baseline.score,
                  latencyMs: 1,
                  costUsd: 0,
                })),
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
