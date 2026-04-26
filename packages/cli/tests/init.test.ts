import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerInitCommand } from "../src/commands/init.js";

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

async function runInit(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const test = createTestIo();
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program, { io: test.io });
  await program.parseAsync(["node", "aidrift", "init", ...args], { from: "node" });
  return { stdout: test.stdout, stderr: test.stderr };
}

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "aidrift-init-test-"));
}

describe("aidrift init", () => {
  it('--dry-run on empty dir exits 0 and stdout contains version: "1", no file created', async () => {
    const tmpDir = await makeTmpDir();
    try {
      const { stdout } = await runInit(["--dir", tmpDir, "--dry-run", "--yes"]);

      expect(stdout).toContain('version: "1"');
      expect(stdout).toContain("name:");

      // No .aistate.yml should be written
      await expect(fs.access(path.join(tmpDir, ".aistate.yml"))).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("--dry-run with a .md file in dir produces manifest with prompt artifact", async () => {
    const tmpDir = await makeTmpDir();
    try {
      await fs.writeFile(path.join(tmpDir, "system-prompt.md"), "You are a helpful assistant.");

      const { stdout } = await runInit(["--dir", tmpDir, "--dry-run", "--yes"]);

      expect(stdout).toContain('version: "1"');
      expect(stdout).toContain("prompt");
      expect(stdout).toContain("system-prompt");

      // No file written in dry-run
      await expect(fs.access(path.join(tmpDir, ".aistate.yml"))).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes .aistate.yml to disk when not --dry-run", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const { stdout } = await runInit(["--dir", tmpDir, "--yes"]);

      // stdout should be empty (content goes to file, not stdout)
      expect(stdout).toBe("");

      const manifestPath = path.join(tmpDir, ".aistate.yml");
      const content = await fs.readFile(manifestPath, "utf8");
      expect(content).toContain('version: "1"');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("--template basic-llm --dry-run outputs template YAML with project name applied", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const projectName = path.basename(tmpDir);
      const { stdout } = await runInit(["--dir", tmpDir, "--template", "basic-llm", "--dry-run"]);

      expect(stdout).toContain('version: "1"');
      expect(stdout).toContain(projectName);
      // Template content should not have the placeholder
      expect(stdout).not.toContain("{{name}}");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("--template with invalid name sets exitCode 2 and writes to stderr", async () => {
    const tmpDir = await makeTmpDir();
    process.exitCode = undefined;
    try {
      const test = createTestIo();
      const program = new Command();
      program.exitOverride();
      registerInitCommand(program, { io: test.io });

      await program.parseAsync(
        ["node", "aidrift", "init", "--dir", tmpDir, "--template", "nonexistent"],
        { from: "node" },
      );

      expect(test.stderr).toContain("Unknown template");
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = undefined;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
