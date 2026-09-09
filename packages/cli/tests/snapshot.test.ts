import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { runCli } from "../src/runner.js";

const MINIMAL_MANIFEST = `
version: "1"
name: test-project
artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o
      parameters:
        temperature: 0.2
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`;

const BEHAVIORAL_MANIFEST = `
version: "1"
name: behavioral-baseline
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
  path: ./state/baselines
`;

const LIVE_MANIFEST = `
version: "1"
name: live-baseline
artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o-2024-08-06
eval:
  suite: ./evals
  target:
    type: provider
    model: primary
storage:
  backend: local
  path: ./.aidrift/snapshots
`;

describe("aidrift snapshot", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-cli-snapshot-"));
    await fs.writeFile(path.join(tmpDir, ".aistate.yml"), MINIMAL_MANIFEST, "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 and creates a snapshot file", async () => {
    const stdout = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };
    const stderr = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };

    const exitCode = await runCli(
      ["node", "aidrift", "snapshot", "-c", path.join(tmpDir, ".aistate.yml")],
      { stdout, stderr },
    );

    expect(exitCode).toBe(0);

    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    const files = await fs.readdir(snapshotsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^snap_\d{8}_\d{6}_\d{3}_[0-9a-f]{8}\.json$/);
  });

  it("snapshot output contains snapshot ID", async () => {
    const stdout = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };
    const stderr = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };

    await runCli(["node", "aidrift", "snapshot", "-c", path.join(tmpDir, ".aistate.yml")], {
      stdout,
      stderr,
    });

    const output = stdout.chunks.join("");
    expect(output).toMatch(/snap_\d{8}_\d{6}_\d{3}_[0-9a-f]{8}/);
  });

  it("--label flag sets the snapshot label", async () => {
    const stdout = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };
    const stderr = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };

    await runCli(
      [
        "node",
        "aidrift",
        "snapshot",
        "-c",
        path.join(tmpDir, ".aistate.yml"),
        "--label",
        "v1-release",
      ],
      { stdout, stderr },
    );

    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    const files = await fs.readdir(snapshotsDir);
    const raw = await fs.readFile(path.join(snapshotsDir, files[0]!), "utf8");
    const snap = JSON.parse(raw) as { label: string };
    expect(snap.label).toBe("v1-release");
  });

  it("documents behavioral baseline, provider, sampling, cost, and tag options", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "snapshot", "--help"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("--with-evals");
    expect(test.stdout).toContain("--with-probes");
    expect(test.stdout).toContain("--provider");
    expect(test.stdout).toContain("--samples");
    expect(test.stdout).toContain("--cost-budget");
    expect(test.stdout).toContain("--tags");
  });

  it("creates complete mock baselines in custom storage and an unchanged check passes", async () => {
    const manifestPath = path.join(tmpDir, ".aistate.yml");
    await fs.writeFile(manifestPath, BEHAVIORAL_MANIFEST, "utf8");
    await fs.mkdir(path.join(tmpDir, "evals"));
    await fs.writeFile(
      path.join(tmpDir, "evals", "baseline.assertions.yml"),
      `suite: baseline
assertions:
  - id: greeting
    type: contains
    input: "hello"
    expected_contains: ["mock:"]
`,
      "utf8",
    );
    const snapshotIo = createTestIo();

    const snapshotExitCode = await runCli(
      [
        "node",
        "aidrift",
        "snapshot",
        "--config",
        manifestPath,
        "--with-evals",
        "--with-probes",
        "--provider",
        "mock",
        "--samples",
        "2",
        "--tags",
        "release,baseline,release",
      ],
      { ...snapshotIo.io, env: {} },
    );

    expect(snapshotExitCode).toBe(0);
    expect(snapshotIo.stderr).toBe("");
    expect(snapshotIo.stdout).toContain("Baseline provider: mock (offline synthetic)");
    expect(snapshotIo.stdout).toContain("Eval baselines: 1");
    expect(snapshotIo.stdout).toContain("Probe baselines: 20");
    expect(snapshotIo.stdout).toContain("Tags: baseline, release");

    const snapshotsDir = path.join(tmpDir, "state", "baselines");
    const files = await fs.readdir(snapshotsDir);
    expect(files).toHaveLength(1);
    const snapshot = JSON.parse(await fs.readFile(path.join(snapshotsDir, files[0]!), "utf8")) as {
      readonly id: string;
      readonly timestamp: string;
      readonly tags: readonly string[];
      readonly eval: {
        readonly baselines: Record<
          string,
          {
            readonly providerId: string;
            readonly modelName: string;
            readonly model: string;
            readonly promptNames: readonly string[];
            readonly capturedAt: string;
            readonly snapshotId: string;
            readonly samples: readonly {
              readonly output: string;
              readonly score: number;
              readonly latencyMs: number;
              readonly costUsd: number;
            }[];
          }
        >;
      };
      readonly probe: {
        readonly baselines: Record<
          string,
          {
            readonly provider: string;
            readonly model: string;
            readonly modelName: string;
            readonly probeId: string;
            readonly capturedAt: string;
            readonly snapshotId: string;
            readonly samples: readonly {
              readonly output: string;
              readonly latencyMs: number;
              readonly costUsd: number;
            }[];
          }
        >;
      };
    };
    expect(snapshot.tags).toEqual(["baseline", "release"]);
    expect(snapshot.eval.baselines.greeting).toMatchObject({
      providerId: "mock",
      modelName: "primary",
      model: "mock-v1",
      promptNames: [],
      capturedAt: snapshot.timestamp,
      snapshotId: snapshot.id,
    });
    expect(snapshot.eval.baselines.greeting?.samples).toHaveLength(2);
    expect(snapshot.eval.baselines.greeting?.samples[0]).toEqual({
      output: expect.stringContaining("mock:"),
      score: 1,
      latencyMs: expect.any(Number),
      costUsd: 0,
    });
    expect(Object.keys(snapshot.probe.baselines)).toHaveLength(20);
    expect(snapshot.probe.baselines["primary/deterministic_math"]).toMatchObject({
      provider: "mock",
      model: "mock-v1",
      modelName: "primary",
      probeId: "deterministic_math",
      capturedAt: snapshot.timestamp,
      snapshotId: snapshot.id,
    });
    expect(snapshot.probe.baselines["primary/deterministic_math"]?.samples).toHaveLength(2);

    const checkIo = createTestIo();
    const checkExitCode = await runCli(["node", "aidrift", "check", "--config", manifestPath], {
      ...checkIo.io,
      env: {},
    });

    expect(checkExitCode).toBe(0);
    expect(checkIo.stderr).toBe("");
    expect(checkIo.stdout).toContain("greeting\tPASS");
    expect(checkIo.stdout).not.toContain("\tNEW\t");
    expect(checkIo.stdout).not.toContain("\tDRIFT\t");
    expect(checkIo.stdout).toContain("Result: PASS");
  });

  it("fails before writing when a live baseline provider credential is missing", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "snapshot",
        "--config",
        path.join(tmpDir, ".aistate.yml"),
        "--with-probes",
        "--provider",
        "openai",
      ],
      { ...test.io, env: {} },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("Code: probe.provider.auth_missing");
    await expect(fs.readdir(path.join(tmpDir, ".aidrift", "snapshots"))).rejects.toThrow();
  });

  it("requires confirmation before any live baseline call", async () => {
    const manifestPath = path.join(tmpDir, ".aistate.yml");
    await fs.writeFile(manifestPath, LIVE_MANIFEST, "utf8");
    await fs.mkdir(path.join(tmpDir, "evals"));
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "snapshot",
        "--config",
        manifestPath,
        "--with-probes",
        "--provider",
        "openai",
      ],
      { ...test.io, env: { AIDRIFT_OPENAI_API_KEY: "test-only-not-a-real-key" } },
    );

    expect(exitCode).toBe(2);
    expect(test.stdout).toContain("AIDRIFT Baseline Cost Estimate");
    expect(test.stderr).toContain("Code: probe.confirmation.required");
    await expect(fs.readdir(path.join(tmpDir, ".aidrift", "snapshots"))).rejects.toThrow();
  });

  it("enforces the live baseline cost budget before any provider call", async () => {
    const manifestPath = path.join(tmpDir, ".aistate.yml");
    await fs.writeFile(manifestPath, LIVE_MANIFEST, "utf8");
    await fs.mkdir(path.join(tmpDir, "evals"));
    const test = createTestIo();

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "snapshot",
        "--config",
        manifestPath,
        "--with-probes",
        "--provider",
        "openai",
        "--cost-budget",
        "0",
      ],
      { ...test.io, env: { AIDRIFT_OPENAI_API_KEY: "test-only-not-a-real-key" } },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("Code: probe.budget.exceeded");
    await expect(fs.readdir(path.join(tmpDir, ".aidrift", "snapshots"))).rejects.toThrow();
  });

  it("rejects invalid sampling and empty tags", async () => {
    const samples = createTestIo();
    const excessiveSamples = createTestIo();
    const tags = createTestIo();
    const manifestPath = path.join(tmpDir, ".aistate.yml");

    expect(
      await runCli(
        ["node", "aidrift", "snapshot", "--config", manifestPath, "--samples", "0"],
        samples.io,
      ),
    ).toBe(2);
    expect(samples.stderr).toContain("Code: snapshot.baseline.option_invalid");

    expect(
      await runCli(
        ["node", "aidrift", "snapshot", "--config", manifestPath, "--samples", "101"],
        excessiveSamples.io,
      ),
    ).toBe(2);
    expect(excessiveSamples.stderr).toContain("Code: snapshot.baseline.option_invalid");

    expect(
      await runCli(
        ["node", "aidrift", "snapshot", "--config", manifestPath, "--tags", " , "],
        tags.io,
      ),
    ).toBe(2);
    expect(tags.stderr).toContain("Code: snapshot.baseline.option_invalid");
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
