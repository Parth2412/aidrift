import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanProject } from "../../src/scanner/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-scanner-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe("scanProject", () => {
  it("returns empty artifacts for an empty directory", async () => {
    const result = await scanProject({ dir: tmpDir });

    expect(result.root).toBe(tmpDir);
    expect(result.artifacts).toEqual([]);
    expect(result.modelProviders).toEqual([]);
  });

  it("detects a .md file as a prompt artifact", async () => {
    await fs.writeFile(path.join(tmpDir, "system.md"), "You are a helpful assistant.");

    const result = await scanProject({ dir: tmpDir });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "prompt",
      relativePath: "system.md",
    });
    expect(result.artifacts[0]?.absolutePath).toBe(path.join(tmpDir, "system.md"));
  });

  it("detects openapi.yml as a tool_schema artifact", async () => {
    await fs.writeFile(path.join(tmpDir, "openapi.yml"), "openapi: 3.0.0\n");

    const result = await scanProject({ dir: tmpDir });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "tool_schema",
      relativePath: "openapi.yml",
    });
    expect(result.artifacts[0]?.absolutePath).toBe(path.join(tmpDir, "openapi.yml"));
  });

  it("detects a rag config file", async () => {
    await fs.writeFile(path.join(tmpDir, "rag-config.yml"), "");
    const result = await scanProject({ dir: tmpDir });
    expect(result.artifacts).toContainEqual(
      expect.objectContaining({ kind: "rag_config", relativePath: "rag-config.yml" }),
    );
  });

  it("detects a .env file as model_env_ref", async () => {
    await fs.writeFile(path.join(tmpDir, ".env"), "");
    const result = await scanProject({ dir: tmpDir });
    expect(result.artifacts).toContainEqual(
      expect.objectContaining({ kind: "model_env_ref", relativePath: ".env" }),
    );
  });

  it("does not include files inside node_modules", async () => {
    const nmDir = path.join(tmpDir, "node_modules", "some-pkg");
    await fs.mkdir(nmDir, { recursive: true });
    await fs.writeFile(path.join(nmDir, "README.md"), "# pkg");

    const result = await scanProject({ dir: tmpDir });

    const nodeModulesArtifacts = result.artifacts.filter((a) =>
      a.relativePath.includes("node_modules"),
    );
    expect(nodeModulesArtifacts).toHaveLength(0);
  });

  it("detects prompt templates without treating general documentation as prompts", async () => {
    await fs.mkdir(path.join(tmpDir, "src", "prompts"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "prompts", "answer.jinja2"), "{{ input }}");
    await fs.writeFile(path.join(tmpDir, "README.md"), "# Documentation");

    const result = await scanProject({ dir: tmpDir });

    expect(result.artifacts).toContainEqual(
      expect.objectContaining({ kind: "prompt", relativePath: "src/prompts/answer.jinja2" }),
    );
    expect(result.artifacts).not.toContainEqual(
      expect.objectContaining({ relativePath: "README.md" }),
    );
  });

  it("detects safety rules in common directories", async () => {
    await fs.mkdir(path.join(tmpDir, "config", "guardrails"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "config", "guardrails", "policy.yml"), "rules: []\n");

    const result = await scanProject({ dir: tmpDir });

    expect(result.artifacts).toContainEqual(
      expect.objectContaining({
        kind: "safety_rules",
        relativePath: "config/guardrails/policy.yml",
      }),
    );
  });

  it("respects root and nested .gitignore files", async () => {
    await fs.mkdir(path.join(tmpDir, "prompts", "nested"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "prompts/ignored.md\n");
    await fs.writeFile(path.join(tmpDir, "prompts", "nested", ".gitignore"), "local.txt\n");
    await fs.writeFile(path.join(tmpDir, "prompts", "kept.md"), "kept");
    await fs.writeFile(path.join(tmpDir, "prompts", "ignored.md"), "ignored");
    await fs.writeFile(path.join(tmpDir, "prompts", "nested", "local.txt"), "ignored");

    const result = await scanProject({ dir: tmpDir });

    expect(result.artifacts.map((artifact) => artifact.relativePath)).toEqual(["prompts/kept.md"]);
  });

  it("does not load a nested .gitignore from a directory ignored by its parent", async () => {
    await fs.mkdir(path.join(tmpDir, "prompts", "ignored"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "prompts/ignored/\n");
    await fs.writeFile(path.join(tmpDir, "prompts", "ignored", ".gitignore"), "!revived.md\n");
    await fs.writeFile(path.join(tmpDir, "prompts", "ignored", "revived.md"), "ignored");
    await fs.writeFile(path.join(tmpDir, "prompts", "kept.md"), "kept");

    const result = await scanProject({ dir: tmpDir });

    expect(result.artifacts.map((artifact) => artifact.relativePath)).toEqual(["prompts/kept.md"]);
  });

  it("fails closed when .gitignore exceeds its resource limit", async () => {
    const gitIgnorePath = path.join(tmpDir, ".gitignore");
    await fs.writeFile(gitIgnorePath, "", "utf8");
    await fs.truncate(gitIgnorePath, 1024 * 1024 + 1);

    await expect(scanProject({ dir: tmpDir })).rejects.toMatchObject({
      code: "project.gitignore.unsafe",
      exitCode: 2,
    });
  });

  it("detects JavaScript provider SDK dependencies", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { openai: "latest", "@anthropic-ai/sdk": "latest" },
        devDependencies: { "cohere-ai": "latest" },
      }),
    );

    const result = await scanProject({ dir: tmpDir });

    expect(result.modelProviders).toEqual([
      {
        name: "anthropic",
        ecosystem: "javascript",
        dependency: "@anthropic-ai/sdk",
        relativePath: "package.json",
      },
      {
        name: "cohere",
        ecosystem: "javascript",
        dependency: "cohere-ai",
        relativePath: "package.json",
      },
      {
        name: "openai",
        ecosystem: "javascript",
        dependency: "openai",
        relativePath: "package.json",
      },
    ]);
  });

  it("detects Python provider dependencies and ignores prose substrings", async () => {
    await fs.writeFile(
      path.join(tmpDir, "pyproject.toml"),
      [
        "[project]",
        'description = "Uses the word openai in prose without adding the package."',
        'dependencies = ["openai>=1", "anthropic~=0.40", "cohere"]',
        "",
      ].join("\n"),
    );
    await fs.writeFile(path.join(tmpDir, "requirements.txt"), "my-openai-wrapper==1.0\n");

    const result = await scanProject({ dir: tmpDir });

    expect(result.modelProviders.map(({ name, relativePath }) => ({ name, relativePath }))).toEqual(
      [
        { name: "anthropic", relativePath: "pyproject.toml" },
        { name: "cohere", relativePath: "pyproject.toml" },
        { name: "openai", relativePath: "pyproject.toml" },
      ],
    );
  });

  it("does not read dependency manifests above the scanner resource limit", async () => {
    const packagePath = path.join(tmpDir, "package.json");
    await fs.writeFile(packagePath, '{"dependencies":{"openai":"latest"}}');
    await fs.truncate(packagePath, 2 * 1024 * 1024 + 1);

    const result = await scanProject({ dir: tmpDir });

    expect(result.modelProviders).toEqual([]);
  });

  it("does not follow dependency manifest symlinks outside the scanned project", async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-scanner-outside-"));
    try {
      const outsidePackage = path.join(outsideDir, "package.json");
      await fs.writeFile(outsidePackage, '{"dependencies":{"openai":"latest"}}');
      await fs.symlink(outsidePackage, path.join(tmpDir, "package.json"));

      const result = await scanProject({ dir: tmpDir });

      expect(result.modelProviders).toEqual([]);
    } finally {
      await fs.rm(outsideDir, { recursive: true });
    }
  });
});
