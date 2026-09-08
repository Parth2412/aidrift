import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { captureSnapshot } from "../../src/snapshot/capture.js";
import type { AIStateManifest } from "../../src/manifest/types.js";

function makeManifest(promptPath: string): AIStateManifest {
  return {
    version: "1",
    name: "test",
    artifacts: {
      prompts: {
        system: { type: "prompt", path: promptPath },
      },
      models: {
        primary: {
          type: "model",
          provider: "openai",
          model: "gpt-4o",
          parameters: { temperature: 0.2 },
        },
      },
    },
    eval: { suite: "./evals" },
    storage: { backend: "local", path: "./.aidrift/snapshots" },
  };
}

describe("captureSnapshot", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-capture-"));
    await fs.writeFile(path.join(tmpDir, ".aistate.yml"), "version: '1'\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a snapshot with expected structure", async () => {
    const promptPath = path.join(tmpDir, "system.md");
    await fs.writeFile(promptPath, "You are a helpful assistant.", "utf8");

    const manifest = makeManifest(promptPath);
    const snap = await captureSnapshot({
      manifest,
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
    });

    expect(snap.schemaVersion).toBe("1");
    expect(snap.id).toMatch(/^snap_\d{8}_\d{6}_\d{3}_[0-9a-f]{8}$/);
    expect(snap.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(snap.metadata.cliVersion).toBe("0.0.0");
  });

  it("captures text artifact with content and hash", async () => {
    const promptPath = path.join(tmpDir, "system.md");
    const content = "You are a helpful assistant.";
    await fs.writeFile(promptPath, content, "utf8");

    const manifest = makeManifest(promptPath);
    const snap = await captureSnapshot({
      manifest,
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
    });

    const promptArtifact = snap.artifacts["prompts/system"];
    expect(promptArtifact).toBeDefined();
    expect(promptArtifact?.kind).toBe("text");
    expect(promptArtifact?.content).toBe(content);
    expect(promptArtifact?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(promptArtifact?.path).toBe("./system.md");
  });

  it("captures model artifact with parameters and hash", async () => {
    const promptPath = path.join(tmpDir, "system.md");
    await fs.writeFile(promptPath, "prompt", "utf8");

    const manifest = makeManifest(promptPath);
    const snap = await captureSnapshot({
      manifest,
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
    });

    const modelArtifact = snap.artifacts["models/primary"];
    expect(modelArtifact).toBeDefined();
    expect(modelArtifact?.kind).toBe("model");
    expect(modelArtifact?.provider).toBe("openai");
    expect(modelArtifact?.model).toBe("gpt-4o");
    expect(modelArtifact?.parameters).toEqual({ temperature: 0.2 });
    expect(modelArtifact?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("accepts optional label and message", async () => {
    const promptPath = path.join(tmpDir, "system.md");
    await fs.writeFile(promptPath, "prompt", "utf8");

    const manifest = makeManifest(promptPath);
    const snap = await captureSnapshot({
      manifest,
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
      label: "release-v1",
      message: "Pre-release snapshot",
    });

    expect(snap.label).toBe("release-v1");
    expect(snap.message).toBe("Pre-release snapshot");
  });

  it("rejects invalid or secret-like capture metadata before it can be persisted", async () => {
    const promptPath = path.join(tmpDir, "system.md");
    await fs.writeFile(promptPath, "prompt", "utf8");
    const options = {
      manifest: makeManifest(promptPath),
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
    };

    await expect(captureSnapshot({ ...options, label: "x".repeat(257) })).rejects.toMatchObject({
      code: "snapshot.corrupt",
      exitCode: 2,
    });
    await expect(
      captureSnapshot({ ...options, tags: ["sk-secretvalue123456789"] }),
    ).rejects.toMatchObject({ code: "snapshot.corrupt", exitCode: 2 });
  });

  it("generates unique readable IDs for rapid captures", async () => {
    const promptPath = path.join(tmpDir, "system.md");
    await fs.writeFile(promptPath, "prompt", "utf8");
    const options = {
      manifest: makeManifest(promptPath),
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
    };

    const [first, second] = await Promise.all([captureSnapshot(options), captureSnapshot(options)]);
    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^snap_\d{8}_\d{6}_\d{3}_[0-9a-f]{8}$/u);
  });

  it("captures every supported artifact shape with deterministic portable keys", async () => {
    await fs.mkdir(path.join(tmpDir, "tools", "nested"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "prompt.md"), "Be helpful.", "utf8");
    await fs.writeFile(path.join(tmpDir, "rag.yml"), "top_k: 4\n", "utf8");
    await fs.writeFile(path.join(tmpDir, "safety.yaml"), "blocked: true\n", "utf8");
    await fs.writeFile(path.join(tmpDir, "tools", "b.json"), '{"name":"b"}\n', "utf8");
    await fs.writeFile(path.join(tmpDir, "tools", "nested", "a.json"), '{"name":"a"}\n', "utf8");
    await fs.writeFile(path.join(tmpDir, "tools", "ignored.json"), "{}", "utf8");
    await fs.writeFile(path.join(tmpDir, "weights.bin"), Buffer.from([0, 1, 2, 3]));
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "tools/ignored.json\n", "utf8");

    const manifest: AIStateManifest = {
      version: "1",
      name: "complete-state",
      artifacts: {
        prompts: { system: { type: "prompt", path: "./prompt.md" } },
        models: {
          primary: {
            type: "model",
            provider: "mock",
            model: "mock-v1",
            parameters: { temperature: 0.2 },
          },
        },
        rag: { config: { type: "rag_config", path: "./rag.yml" } },
        tools: {
          schemas: { type: "tool_schema", path: "./tools", glob: "**/*.json" },
        },
        safety: { rules: { type: "safety_rules", path: "./safety.yaml" } },
        adapters: {
          weights: { type: "adapter", path: "./weights.bin", hash_algorithm: "sha256" },
        },
      },
      eval: { suite: "./evals" },
      storage: { backend: "local", path: "./state/snapshots" },
    };

    const snapshot = await captureSnapshot({
      manifest,
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
    });

    expect(Object.keys(snapshot.artifacts)).toEqual([
      "adapters/weights",
      "models/primary",
      "prompts/system",
      "rag/config",
      "safety/rules",
      "tools/schemas/b.json",
      "tools/schemas/nested/a.json",
    ]);
    expect(snapshot.artifacts["prompts/system"]).toMatchObject({
      kind: "text",
      path: "./prompt.md",
      contentType: "text",
    });
    expect(snapshot.artifacts["rag/config"]?.contentType).toBe("yaml");
    expect(snapshot.artifacts["tools/schemas/b.json"]?.contentType).toBe("json");
    expect(snapshot.artifacts["adapters/weights"]).toMatchObject({
      kind: "binary",
      path: "./weights.bin",
      sizeBytes: 4,
    });
    expect(snapshot.artifacts["adapters/weights"]?.content).toBeUndefined();
  });

  it("rejects artifact paths outside the manifest project", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-capture-outside-"));
    try {
      const outsidePrompt = path.join(outside, "prompt.md");
      await fs.writeFile(outsidePrompt, "secret", "utf8");

      await expect(
        captureSnapshot({
          manifest: makeManifest(outsidePrompt),
          manifestPath: path.join(tmpDir, ".aistate.yml"),
          projectRoot: tmpDir,
          cliVersion: "0.0.0",
        }),
      ).rejects.toMatchObject({ code: "path.outside_project", exitCode: 2 });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects direct ignored files and secret-like artifact content", async () => {
    const ignoredPath = path.join(tmpDir, "ignored.md");
    await fs.writeFile(ignoredPath, "benign", "utf8");
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "ignored.md\n", "utf8");

    await expect(
      captureSnapshot({
        manifest: makeManifest(ignoredPath),
        manifestPath: path.join(tmpDir, ".aistate.yml"),
        projectRoot: tmpDir,
        cliVersion: "0.0.0",
      }),
    ).rejects.toMatchObject({ code: "snapshot.artifact.ignored", exitCode: 2 });

    const secretPath = path.join(tmpDir, "prompt.md");
    await fs.writeFile(secretPath, "Use token sk-secretvalue123456789", "utf8");
    await expect(
      captureSnapshot({
        manifest: makeManifest(secretPath),
        manifestPath: path.join(tmpDir, ".aistate.yml"),
        projectRoot: tmpDir,
        cliVersion: "0.0.0",
      }),
    ).rejects.toMatchObject({ code: "snapshot.artifact.secret_detected", exitCode: 2 });
  });

  it("captures a file explicitly re-included by .gitignore", async () => {
    const promptPath = path.join(tmpDir, "prompt.md");
    await fs.writeFile(promptPath, "benign", "utf8");
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "*.md\n!prompt.md\n", "utf8");

    const snapshot = await captureSnapshot({
      manifest: makeManifest(promptPath),
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
    });

    expect(snapshot.artifacts["prompts/system"]?.content).toBe("benign");
  });

  it("rejects unbounded text artifacts before reading their content", async () => {
    const largePath = path.join(tmpDir, "large.txt");
    await fs.writeFile(largePath, "", "utf8");
    await fs.truncate(largePath, 10 * 1024 * 1024 + 1);

    await expect(
      captureSnapshot({
        manifest: makeManifest(largePath),
        manifestPath: path.join(tmpDir, ".aistate.yml"),
        projectRoot: tmpDir,
        cliVersion: "0.0.0",
      }),
    ).rejects.toMatchObject({ code: "snapshot.artifact.too_large", exitCode: 2 });
  });

  it("rejects oversized binary artifacts before hashing their content", async () => {
    const promptPath = path.join(tmpDir, "system.md");
    const adapterPath = path.join(tmpDir, "weights.bin");
    await fs.writeFile(promptPath, "prompt", "utf8");
    await fs.writeFile(adapterPath, "", "utf8");
    await fs.truncate(adapterPath, 256 * 1024 * 1024 + 1);
    const source = makeManifest(promptPath);

    await expect(
      captureSnapshot({
        manifest: {
          ...source,
          artifacts: {
            ...source.artifacts,
            adapters: {
              weights: { type: "adapter", path: adapterPath, hash_algorithm: "sha256" },
            },
          },
        },
        manifestPath: path.join(tmpDir, ".aistate.yml"),
        projectRoot: tmpDir,
        cliVersion: "0.0.0",
      }),
    ).rejects.toMatchObject({ code: "snapshot.capture.limit_exceeded", exitCode: 2 });
  });

  it("collects git metadata from projectRoot instead of the process directory", async () => {
    const promptPath = path.join(tmpDir, "system.md");
    await fs.writeFile(promptPath, "prompt", "utf8");
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.name", "AIDrift Test"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: tmpDir });
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-qm", "test baseline"], { cwd: tmpDir });

    const snapshot = await captureSnapshot({
      manifest: makeManifest(promptPath),
      manifestPath: path.join(tmpDir, ".aistate.yml"),
      projectRoot: tmpDir,
      cliVersion: "0.0.0",
    });

    expect(snapshot.metadata.gitCommit).toMatch(/^[0-9a-f]+$/u);
    expect(snapshot.metadata.gitBranch).toBeTruthy();
    expect(snapshot.metadata.gitDirty).toBe(false);
  });
});
