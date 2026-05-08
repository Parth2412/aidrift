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
      provider: openai
      model: gpt-4o-2024-08-06
eval:
  suite: ./evals
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

  it("--probe-providers runs Phase 10 mocked provider probes", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "plan", "--probe-providers"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Provider probes: 20");
    expect(test.stderr).toBe("");
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
    expect(test.stderr).toContain("probe-costs.md");
    expect(test.stderr).toContain("Code: probe.provider.auth_missing");
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
    expect(test.stderr).toContain("probe-costs.md");
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
    expect(parsed.results).toEqual([{ assertionId: "alpha", status: "NEW" }]);
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
    expect(files[0]).toMatch(/^plan_\d{8}_\d{6}\.json$/);
  });

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
