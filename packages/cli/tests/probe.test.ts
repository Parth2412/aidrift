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
  });

  it("--estimate-cost exits 0 without running probes", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "probe", "--estimate-cost"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Estimated requests: 100");
    expect(test.stderr).toBe("");
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
      readonly summary: { readonly total: number; readonly new: number };
      readonly results: readonly { readonly probeId: string; readonly status: string }[];
    };
    expect(parsed.summary).toMatchObject({ total: 4, new: 4 });
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

  it("--provider chat-completions exits 2 when OPENAI_API_KEY is missing", async () => {
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
    expect(test.stderr).toContain("probe-costs.md");
    expect(test.stderr).toContain("Code: probe.provider.auth_missing");
  });

  it("--provider messages-api exits 2 when ANTHROPIC_API_KEY is missing", async () => {
    const test = createTestIo();

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
    expect(test.stderr).toContain("probe-costs.md");
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
