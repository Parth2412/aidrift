import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCli } from "../src/runner.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const validManifestPath = path.resolve(
  testDir,
  "../../core/tests/fixtures/manifest/valid/.aistate.yml",
);
const unpinnedManifestPath = path.resolve(
  testDir,
  "../../core/tests/fixtures/manifest/valid/.aistate.unpinned.yml",
);

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
      env: {},
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

describe("runCli", () => {
  it("prints current help when invoked without arguments", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Usage: aidrift");
    expect(test.stderr).toBe("");
  });

  it("prints help for --help", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "--help"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Usage:");
    expect(test.stdout).toContain("--config");
    expect(test.stderr).toBe("");
  });

  it("prints version for --version", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "--version"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout.trim()).toBe("0.9.0-beta.0");
    expect(test.stderr).toBe("");
  });

  it("returns config error for unknown commands", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "unknown"], test.io);

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("unknown command");
  });

  it("prints current help when global options are provided without a command", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "--debug", "--no-color"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Usage: aidrift");
    expect(test.stdout).toContain("check [options]");
    expect(test.stdout).not.toContain("implemented in later phases");
  });

  it("validates a manifest from --config", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", validManifestPath, "validate"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("Manifest is valid");
    expect(test.stderr).toBe("");
  });

  it("suppresses successful command output in quiet mode", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--quiet", "--config", validManifestPath, "validate"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toBe("");
    expect(test.stderr).toBe("");
  });

  it("returns failure when manifest validation fails", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", path.join(testDir, "missing.yml"), "validate"],
      test.io,
    );

    expect(exitCode).toBe(1);
    expect(test.stderr).toContain("manifest file does not exist");
  });

  it("returns failure for strict manifest warnings", async () => {
    const test = createTestIo();

    const exitCode = await runCli(
      ["node", "aidrift", "--config", unpinnedManifestPath, "validate", "--strict"],
      test.io,
    );

    expect(exitCode).toBe(1);
    expect(test.stderr).toContain("manifest.model.unpinned");
  });
});
