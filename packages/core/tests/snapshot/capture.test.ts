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
    storage: { backend: "local", path: ".aidrift" },
  };
}

describe("captureSnapshot", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-capture-"));
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
    expect(snap.id).toMatch(/^snap_\d{8}_\d{6}$/);
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
});
