import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { validateManifestFile, validateManifestSource } from "@zettacore/aidrift-core";

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
      expect(stdout).toContain("provider: mock");
      expect(stdout).toContain("target:");
      expect(stdout).toContain("model: primary");

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
      expect(stdout).toMatch(/prompts:\n\s+- "system-prompt"/u);

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
      const starterSuite = await fs.readFile(
        path.join(tmpDir, "evals", "starter.assertions.yml"),
        "utf8",
      );
      expect(starterSuite).toContain("id: returns-non-empty-response");
      expect(starterSuite).toContain('pattern: ".+"');
      await expect(fs.stat(path.join(tmpDir, ".aidrift"))).resolves.toMatchObject({});
      await expect(fs.readFile(path.join(tmpDir, ".gitignore"), "utf8")).resolves.toContain(
        ".aidrift/",
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves an existing eval suite", async () => {
    const tmpDir = await makeTmpDir();
    const suitePath = path.join(tmpDir, "evals", "custom.assertions.yml");
    try {
      await fs.mkdir(path.dirname(suitePath), { recursive: true });
      await fs.writeFile(suitePath, "suite: custom\nassertions: []\n", "utf8");

      await runInit(["--dir", tmpDir, "--yes"]);

      expect(await fs.readFile(suitePath, "utf8")).toBe("suite: custom\nassertions: []\n");
      await expect(
        fs.access(path.join(tmpDir, "evals", "starter.assertions.yml")),
      ).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves existing .gitignore rules and adds the AIDrift rule once", async () => {
    const tmpDir = await makeTmpDir();
    const gitignorePath = path.join(tmpDir, ".gitignore");
    try {
      await fs.writeFile(gitignorePath, "node_modules/\n", "utf8");

      await runInit(["--dir", tmpDir, "--yes"]);
      await runInit(["--dir", tmpDir, "--yes", "--force"]);

      const content = await fs.readFile(gitignorePath, "utf8");
      expect(content).toContain("node_modules/\n");
      expect(content.match(/^\.aidrift\/$/gmu)).toHaveLength(1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("restores the AIDrift ignore rule after an explicit negation", async () => {
    const tmpDir = await makeTmpDir();
    const gitignorePath = path.join(tmpDir, ".gitignore");
    try {
      await fs.writeFile(gitignorePath, ".aidrift/\n!.aidrift/\n", "utf8");

      await runInit(["--dir", tmpDir, "--yes"]);

      const rules = (await fs.readFile(gitignorePath, "utf8"))
        .split(/\r?\n/u)
        .filter((line) => line === ".aidrift/" || line === "!.aidrift/");
      expect(rules).toEqual([".aidrift/", "!.aidrift/", ".aidrift/"]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "refuses symlinked initialization paths without writing outside the project",
    async () => {
      const tmpDir = await makeTmpDir();
      const outsideDir = await makeTmpDir();
      process.exitCode = undefined;
      try {
        await fs.symlink(outsideDir, path.join(tmpDir, "evals"), "dir");

        const result = await runInit(["--dir", tmpDir, "--yes"]);

        expect(process.exitCode).toBe(1);
        expect(result.stderr).toContain("refusing to write through symbolic link");
        await expect(fs.access(path.join(tmpDir, ".aistate.yml"))).rejects.toThrow();
        await expect(fs.access(path.join(outsideDir, "starter.assertions.yml"))).rejects.toThrow();
      } finally {
        process.exitCode = undefined;
        await fs.rm(tmpDir, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    },
  );

  it("preserves an existing manifest unless --force is explicit", async () => {
    const tmpDir = await makeTmpDir();
    const manifestPath = path.join(tmpDir, ".aistate.yml");
    process.exitCode = undefined;
    try {
      await fs.writeFile(manifestPath, "original manifest\n", "utf8");

      const refused = await runInit(["--dir", tmpDir, "--yes"]);

      expect(process.exitCode).toBe(2);
      expect(refused.stderr).toContain("manifest already exists");
      expect(await fs.readFile(manifestPath, "utf8")).toBe("original manifest\n");

      process.exitCode = undefined;
      await runInit(["--dir", tmpDir, "--yes", "--force"]);

      expect(process.exitCode).toBeUndefined();
      expect(await fs.readFile(manifestPath, "utf8")).toContain('version: "1"');
    } finally {
      process.exitCode = undefined;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses exclusive creation when initialization races with a new manifest", async () => {
    const tmpDir = await makeTmpDir();
    const manifestPath = path.join(tmpDir, ".aistate.yml");
    process.exitCode = undefined;
    try {
      const originalWriteFile = fs.writeFile;
      let injected = false;
      const writeFileSpy = vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
        const [filename] = args;
        if (!injected && filename === manifestPath) {
          injected = true;
          await originalWriteFile(manifestPath, "concurrent manifest\n", "utf8");
        }
        return originalWriteFile(...args);
      });

      const result = await runInit(["--dir", tmpDir, "--yes"]);

      expect(process.exitCode).toBe(1);
      expect(result.stderr).toContain("EEXIST");
      expect(await fs.readFile(manifestPath, "utf8")).toBe("concurrent manifest\n");
      writeFileSpy.mockRestore();
    } finally {
      vi.restoreAllMocks();
      process.exitCode = undefined;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("quotes detected paths and keeps colliding normalized keys unique", async () => {
    const tmpDir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(tmpDir, "prompts", "a"), { recursive: true });
      await fs.mkdir(path.join(tmpDir, "evals"));
      await fs.writeFile(path.join(tmpDir, "prompts", "prompt #1.md"), "safe prompt\n", "utf8");
      await fs.writeFile(path.join(tmpDir, "prompts", "a", "b.md"), "nested prompt\n", "utf8");
      await fs.writeFile(path.join(tmpDir, "prompts", "a_b.md"), "flat prompt\n", "utf8");

      const { stdout } = await runInit(["--dir", tmpDir, "--dry-run", "--yes"]);
      const validation = await validateManifestSource({
        manifestPath: path.join(tmpDir, ".aistate.yml"),
        source: stdout,
      });

      expect(validation.errors).toEqual([]);
      expect(Object.keys(validation.manifest?.artifacts.prompts ?? {})).toHaveLength(3);
      expect(validation.manifest?.artifacts.prompts).toHaveProperty("prompts_a_b");
      expect(validation.manifest?.artifacts.prompts).toHaveProperty("prompts_a_b_2");
      expect(validation.manifest?.artifacts.prompts?.["prompts_prompt #1"]?.path).toBe(
        "./prompts/prompt #1.md",
      );
      expect(validation.manifest?.eval.target).toMatchObject({
        prompts: expect.arrayContaining(["prompts_a_b", "prompts_a_b_2", "prompts_prompt #1"]),
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes detected safety policies into a valid manifest", async () => {
    const tmpDir = await makeTmpDir();
    try {
      await fs.mkdir(path.join(tmpDir, "safety"), { recursive: true });
      await fs.mkdir(path.join(tmpDir, "evals"));
      await fs.writeFile(path.join(tmpDir, "safety", "rules.yml"), "rules: []\n", "utf8");

      const { stdout } = await runInit(["--dir", tmpDir, "--dry-run", "--yes"]);
      const validation = await validateManifestSource({
        manifestPath: path.join(tmpDir, ".aistate.yml"),
        source: stdout,
      });

      expect(validation.errors).toEqual([]);
      expect(validation.manifest?.artifacts.safety).toHaveProperty("safety_rules");
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

  it.each([
    ["basic-llm", []],
    ["rag-pipeline", ["rag/config.yml"]],
    ["agent", ["tools/openapi.yml", "safety/rules.yml"]],
  ] as const)("--template %s creates a manifest that validates", async (template, files) => {
    const tmpDir = await makeTmpDir();
    try {
      await runInit(["--dir", tmpDir, "--template", template]);

      const result = await validateManifestFile({
        manifestPath: path.join(tmpDir, ".aistate.yml"),
      });
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      await expect(
        fs.readFile(path.join(tmpDir, "evals", "starter.assertions.yml"), "utf8"),
      ).resolves.toContain("returns-non-empty-response");
      for (const relativePath of files) {
        await expect(fs.readFile(path.join(tmpDir, relativePath), "utf8")).resolves.not.toBe("");
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves existing template artifact files", async () => {
    const tmpDir = await makeTmpDir();
    const configPath = path.join(tmpDir, "rag", "config.yml");
    try {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "user-owned: true\n", "utf8");

      await runInit(["--dir", tmpDir, "--template", "rag-pipeline"]);

      expect(await fs.readFile(configPath, "utf8")).toBe("user-owned: true\n");
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
