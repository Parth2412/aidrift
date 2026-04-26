import { describe, expect, it } from "vitest";

import { runCli } from "../src/runner.js";

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
    expect(test.stdout.trim()).toBe("0.0.0");
    expect(test.stderr).toBe("");
  });

  it("returns config error for unknown commands", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "unknown"], test.io);

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("unknown command");
  });

  it("prints bootstrap status for no command and resolves global options", async () => {
    const test = createTestIo();

    const exitCode = await runCli(["node", "aidrift", "--debug", "--no-color"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("CLI foundation initialized");
    expect(test.stdout).toContain("Log level: debug");
    expect(test.stdout).toContain("Color: disabled");
  });
});
