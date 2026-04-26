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
});
