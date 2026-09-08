import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveProviderEvalTarget } from "../../src/eval/target.js";
import type { AIStateManifest } from "../../src/manifest/types.js";

describe("provider eval target", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-eval-target-"));
    await fs.writeFile(path.join(tmpDir, "system.txt"), "Be concise.", "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves the selected model and ordered text prompts", async () => {
    const target = await resolveProviderEvalTarget(manifest(), tmpDir);

    expect(target).toMatchObject({
      modelName: "primary",
      promptNames: ["system"],
      systemPrompt: "Be concise.",
      model: { provider: "mock", model: "mock-v1", parameters: { temperature: 0 } },
    });
  });

  it("rejects secret-like prompt content", async () => {
    await fs.writeFile(path.join(tmpDir, "system.txt"), "Bearer abcdefghijklmnop", "utf8");

    await expect(resolveProviderEvalTarget(manifest(), tmpDir)).rejects.toMatchObject({
      code: "eval.target.invalid",
      exitCode: 2,
    });
  });

  it("supports a provider target with no declared prompts", async () => {
    const source = manifest();
    const target = await resolveProviderEvalTarget(
      {
        ...source,
        artifacts: { models: source.artifacts.models },
        eval: { ...source.eval, target: { type: "provider", model: "primary" } },
      },
      tmpDir,
    );

    expect(target.promptNames).toEqual([]);
    expect(target.systemPrompt).toBeUndefined();
  });

  it("rejects missing targets, unknown models, unknown prompts, and unapplied prompts", async () => {
    const source = manifest();
    const invalidManifests: AIStateManifest[] = [
      { ...source, eval: { suite: "./evals" } },
      {
        ...source,
        eval: {
          ...source.eval,
          target: { type: "provider", model: "missing", prompts: ["system"] },
        },
      },
      {
        ...source,
        eval: {
          ...source.eval,
          target: { type: "provider", model: "primary", prompts: ["system", "missing"] },
        },
      },
      {
        ...source,
        eval: { ...source.eval, target: { type: "provider", model: "primary" } },
      },
    ];

    for (const invalid of invalidManifests) {
      await expect(resolveProviderEvalTarget(invalid, tmpDir)).rejects.toMatchObject({
        code: "eval.target.invalid",
        exitCode: 2,
      });
    }
  });

  it("rejects non-text prompt formats and prompt paths that are not files", async () => {
    const source = manifest();
    await expect(
      resolveProviderEvalTarget(
        {
          ...source,
          artifacts: {
            ...source.artifacts,
            prompts: { system: { type: "prompt", path: "./system.txt", format: "jinja2" } },
          },
        },
        tmpDir,
      ),
    ).rejects.toMatchObject({ code: "eval.target.invalid" });

    await fs.mkdir(path.join(tmpDir, "prompt-directory"));
    await expect(
      resolveProviderEvalTarget(
        {
          ...source,
          artifacts: {
            ...source.artifacts,
            prompts: { system: { type: "prompt", path: "./prompt-directory", format: "text" } },
          },
        },
        tmpDir,
      ),
    ).rejects.toMatchObject({ code: "eval.target.invalid" });
  });

  it("rejects a prompt symlink that escapes the project", async () => {
    if (process.platform === "win32") return;
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-target-outside-"));
    try {
      await fs.writeFile(path.join(outside, "prompt.txt"), "outside", "utf8");
      await fs.rm(path.join(tmpDir, "system.txt"));
      await fs.symlink(path.join(outside, "prompt.txt"), path.join(tmpDir, "system.txt"));

      await expect(resolveProviderEvalTarget(manifest(), tmpDir)).rejects.toMatchObject({
        code: "path.symlink_escape",
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects prompts that exceed the aggregate execution limit", async () => {
    const source = manifest();
    const secondPromptPath = path.join(tmpDir, "policy.txt");
    await fs.truncate(path.join(tmpDir, "system.txt"), 6 * 1024 * 1024);
    await fs.writeFile(secondPromptPath, "", "utf8");
    await fs.truncate(secondPromptPath, 6 * 1024 * 1024);

    await expect(
      resolveProviderEvalTarget(
        {
          ...source,
          artifacts: {
            ...source.artifacts,
            prompts: {
              ...source.artifacts.prompts,
              policy: { type: "prompt", path: "./policy.txt", format: "text" },
            },
          },
          eval: {
            ...source.eval,
            target: {
              type: "provider",
              model: "primary",
              prompts: ["system", "policy"],
            },
          },
        },
        tmpDir,
      ),
    ).rejects.toMatchObject({ code: "eval.target.invalid", exitCode: 2 });
  });
});

function manifest(): AIStateManifest {
  return {
    version: "1",
    name: "target-test",
    artifacts: {
      prompts: { system: { type: "prompt", path: "./system.txt", format: "text" } },
      models: {
        primary: {
          type: "model",
          provider: "mock",
          model: "mock-v1",
          parameters: { temperature: 0 },
        },
      },
    },
    eval: {
      suite: "./evals",
      target: { type: "provider", model: "primary", prompts: ["system"] },
    },
    storage: { backend: "local", path: "./.aidrift/snapshots" },
  };
}
