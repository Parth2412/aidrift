import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateManifestFile, validateManifestSource } from "../../src/manifest/parser.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(testDir, "../fixtures/manifest/valid");
const validManifestPath = path.join(fixtureRoot, ".aistate.yml");

describe("validateManifestFile", () => {
  it("accepts a valid manifest and resolves referenced paths", async () => {
    const result = await validateManifestFile({ manifestPath: validManifestPath });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.manifest?.name).toBe("fixture-ai-service");
    expect(result.resolvedPaths.map((entry) => entry.manifestPath)).toContain(
      "artifacts.prompts.system.path",
    );
    expect(result.resolvedPaths.map((entry) => entry.manifestPath)).toContain("eval.suite");
  });

  it("reports invalid YAML with a line number", async () => {
    const result = await validateManifestSource({
      manifestPath: path.join(fixtureRoot, ".aistate.yml"),
      source: 'version: "1"\nname: [\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: "manifest.yaml.invalid",
      line: 2,
    });
  });

  it("rejects excessive YAML alias expansion", async () => {
    const result = await validateManifestSource({
      manifestPath: validManifestPath,
      source: `
a: &a [x, x, x, x, x, x, x, x, x, x]
b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]
c: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]
`,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "manifest.yaml.invalid" }),
    );
  });

  it("rejects deeply nested manifest values before recursive validation", async () => {
    const result = await validateManifestSource({
      manifestPath: validManifestPath,
      source: `deep: ${"[".repeat(70)}value${"]".repeat(70)}\n`,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "manifest.complexity.exceeded" }),
    );
  });

  it("rejects oversized manifest files before parsing them", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-large-manifest-"));
    const manifestPath = path.join(directory, ".aistate.yml");
    try {
      await fs.writeFile(manifestPath, "", "utf8");
      await fs.truncate(manifestPath, 2 * 1024 * 1024 + 1);

      const result = await validateManifestFile({ manifestPath });

      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "manifest.file.too_large" }),
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("reports unsafe .gitignore input without misclassifying the manifest as missing", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-gitignore-limit-"));
    const manifestPath = path.join(projectDir, ".aistate.yml");
    try {
      await fs.mkdir(path.join(projectDir, "evals"));
      await fs.writeFile(
        path.join(projectDir, "evals", "basic.assertions.yml"),
        "suite: basic\nassertions: []\n",
        "utf8",
      );
      await fs.writeFile(
        manifestPath,
        `version: "1"
name: gitignore-limit
artifacts: {}
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
        "utf8",
      );
      await fs.writeFile(path.join(projectDir, ".gitignore"), "", "utf8");
      await fs.truncate(path.join(projectDir, ".gitignore"), 1024 * 1024 + 1);

      const result = await validateManifestFile({ manifestPath });

      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "project.gitignore.unsafe" }),
      );
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({ code: "manifest.file.missing" }),
      );
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it("reports missing required fields from schema validation", async () => {
    const result = await validateManifestSource({
      manifestPath: path.join(fixtureRoot, ".aistate.yml"),
      source: 'version: "1"\nname: missing-storage\nartifacts: {}\neval:\n  suite: ./evals\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "manifest.schema.invalid")).toBe(true);
    expect(result.errors.map((issue) => issue.message).join("\n")).toContain("storage");
  });

  it("reports referenced file paths that do not exist", async () => {
    const result = await validateManifestSource({
      manifestPath: path.join(fixtureRoot, ".aistate.yml"),
      source: `version: "1"
name: missing-path
artifacts:
  prompts:
    system:
      type: prompt
      path: ./prompts/missing.md
      format: text
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "manifest.path.missing",
        manifestPath: "artifacts.prompts.system.path",
      }),
    );
  });

  it("rejects artifact and storage paths outside the manifest project", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-validation-project-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-validation-outside-"));
    try {
      await fs.mkdir(path.join(projectDir, "evals"));
      await fs.writeFile(path.join(outsideDir, "prompt.md"), "outside\n", "utf8");
      const result = await validateManifestSource({
        manifestPath: path.join(projectDir, ".aistate.yml"),
        source: `version: "1"
name: escaped-paths
artifacts:
  prompts:
    system:
      type: prompt
      path: ${JSON.stringify(path.join(outsideDir, "prompt.md"))}
  models:
    primary:
      type: model
      provider: mock
      model: mock-v1
eval:
  suite: ./evals
  target:
    type: provider
    model: primary
    prompts: [system]
storage:
  backend: local
  path: ${JSON.stringify(path.join(outsideDir, "snapshots"))}
`,
      });

      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "path.outside_project",
            manifestPath: "artifacts.prompts.system.path",
          }),
          expect.objectContaining({ code: "path.outside_project", manifestPath: "storage.path" }),
        ]),
      );
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "rejects eval-suite symlinks that escape the manifest project",
    async () => {
      const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-validation-project-"));
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-validation-outside-"));
      try {
        await fs.writeFile(path.join(outsideDir, "suite.yml"), "suite: outside\n", "utf8");
        await fs.symlink(outsideDir, path.join(projectDir, "evals"), "dir");
        const result = await validateManifestSource({
          manifestPath: path.join(projectDir, ".aistate.yml"),
          source: `version: "1"
name: escaped-suite
artifacts: {}
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
        });

        expect(result.errors).toContainEqual(
          expect.objectContaining({ code: "path.symlink_escape", manifestPath: "eval.suite" }),
        );
      } finally {
        await fs.rm(projectDir, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    },
  );

  it("reports unknown model providers", async () => {
    const result = await validateManifestSource({
      manifestPath: path.join(fixtureRoot, ".aistate.yml"),
      source: `version: "1"
name: unknown-provider
artifacts:
  models:
    primary:
      type: model
      provider: imaginary-ai
      model: imaginary-1-2026-01-01
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "manifest.provider.unknown",
        manifestPath: "artifacts.models.primary.provider",
      }),
    );
  });

  it("validates the executable assertion schema, not only YAML syntax", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-validation-suite-"));
    try {
      await fs.mkdir(path.join(projectDir, "evals"));
      await fs.writeFile(
        path.join(projectDir, "evals", "invalid.assertions.yml"),
        "suite: invalid\nassertions:\n  - id: missing-input\n    type: regex\n    pattern: ok\n",
        "utf8",
      );
      const result = await validateManifestSource({
        manifestPath: path.join(projectDir, ".aistate.yml"),
        source: `version: "1"
name: invalid-suite
artifacts: {}
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
      });

      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "assertion.schema.invalid", manifestPath: "eval.suite" }),
      );
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it("turns unpinned model warnings into failures in strict mode", async () => {
    const result = await validateManifestSource({
      manifestPath: path.join(fixtureRoot, ".aistate.yml"),
      strict: true,
      source: `version: "1"
name: unpinned-model
artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
    });

    expect(result.valid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "manifest.model.unpinned",
        manifestPath: "artifacts.models.primary.model",
      }),
    );
  });

  it("rejects secrets embedded in the manifest", async () => {
    const result = await validateManifestSource({
      manifestPath: path.join(fixtureRoot, ".aistate.yml"),
      source: `version: "1"
name: secret-manifest
artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o-2024-08-06
      parameters:
        api_key: sk-test-secret
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "manifest.secret.disallowed",
      }),
    );
  });

  it("rejects unknown and unapplied eval target artifact references", async () => {
    const base = `version: "1"
name: invalid-target
artifacts:
  prompts:
    system:
      type: prompt
      path: ./prompts/system.md
  models:
    primary:
      type: model
      provider: mock
      model: mock-v1
eval:
  suite: ./evals
  target:
    type: provider
    model: primary
storage:
  backend: local
  path: ./.aidrift/snapshots
`;
    const unapplied = await validateManifestSource({
      manifestPath: validManifestPath,
      source: base,
    });
    expect(unapplied.errors).toContainEqual(
      expect.objectContaining({ code: "manifest.eval.target.prompt_unapplied" }),
    );

    const unknownModel = await validateManifestSource({
      manifestPath: validManifestPath,
      source: base
        .replace("model: primary", "model: missing")
        .replace(
          "    model: missing\nstorage:",
          "    model: missing\n    prompts: [system]\nstorage:",
        ),
    });
    expect(unknownModel.errors).toContainEqual(
      expect.objectContaining({ code: "manifest.eval.target.model_unknown" }),
    );
  });

  it("rejects unknown eval settings instead of silently ignoring them", async () => {
    const result = await validateManifestSource({
      manifestPath: validManifestPath,
      source: `version: "1"
name: ignored-eval-setting
artifacts: {}
eval:
  suite: ./evals
  unsupported_setting: true
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "manifest.schema.invalid",
        manifestPath: "eval",
      }),
    );
  });
});
