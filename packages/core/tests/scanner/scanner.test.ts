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
});
