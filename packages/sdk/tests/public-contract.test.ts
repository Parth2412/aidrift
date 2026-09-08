import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  AIDriftPlugin,
  AISystemOutput,
  ArtifactResolver,
  AssertionConfig,
  AssertionEvaluator,
  AssertionResult,
  EvalProvider,
  OutputFormatter,
  SnapshotRecord,
  StorageBackend,
} from "../src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("@zettacore/aidrift-sdk public contract", () => {
  it("keeps plugin extension interfaces structurally composable", async () => {
    const evaluator: AssertionEvaluator = {
      type: "example",
      async evaluate(
        _input: string,
        output: AISystemOutput,
        config: AssertionConfig,
      ): Promise<AssertionResult> {
        return {
          assertionId: config.id,
          passed: output.content.length > 0,
          score: 1,
          confidence: 1,
          details: { expected: "content", actual: output.content, explanation: "example" },
        };
      },
    };
    const resolver: ArtifactResolver = {
      type: "example",
      provider: "test",
      async hash() {
        return "sha256:example";
      },
      async diff(baseline, current) {
        return { changed: baseline !== current, summary: "compared" };
      },
    };
    const formatter: OutputFormatter<{ readonly passed: boolean }> = {
      format: "example",
      render: (value) => String(value.passed),
    };
    const records = new Map<string, SnapshotRecord>();
    const storage: StorageBackend = {
      name: "memory",
      async save(snapshot) {
        records.set(snapshot.id, snapshot);
      },
      async load(id) {
        const snapshot = records.get(id);
        if (snapshot === undefined) throw new Error("missing");
        return snapshot;
      },
      async list() {
        return [...records.values()].map(({ id, createdAt }) => ({ id, createdAt }));
      },
      async delete(id) {
        records.delete(id);
      },
    };
    const plugin: AIDriftPlugin = {
      name: "contract-test",
      version: "1.0.0",
      resolvers: [resolver],
      evaluators: [evaluator],
      formatters: [formatter],
      storage: [storage],
    };

    const result = await evaluator.evaluate(
      "input",
      { content: "ok" },
      {
        id: "assertion",
        type: "example",
        input: "input",
      },
    );

    expect(plugin.name).toBe("contract-test");
    expect(result).toMatchObject({ assertionId: "assertion", passed: true });
    expectTypeOf(plugin.storage).toEqualTypeOf<readonly StorageBackend[] | undefined>();
  });

  it("keeps provider request and output contracts type-safe", async () => {
    const provider: EvalProvider = {
      id: "test",
      async generate(request) {
        return { content: request.input, latencyMs: 1 };
      },
    };

    const output = await provider.generate({ input: "hello", assertionId: "a-1" });

    expect(output).toEqual({ content: "hello", latencyMs: 1 });
    expectTypeOf(output.content).toBeString();
    expectTypeOf(output.latencyMs).toBeNumber();
  });

  it.each([
    ["aistate.v1.schema.json", "https://aidrift.dev/schemas/aistate.v1.schema.json"],
    ["check-output.v1.json", "https://aidrift.dev/schemas/check-output.v1.json"],
    ["check-output.v2.json", "https://aidrift.dev/schemas/check-output.v2.json"],
    ["check-output.v3.json", "https://aidrift.dev/schemas/check-output.v3.json"],
  ])("packages the versioned %s schema", async (filename, expectedId) => {
    const schema = JSON.parse(
      await fs.readFile(path.join(packageRoot, "schemas", filename), "utf8"),
    ) as { readonly $id?: unknown; readonly $schema?: unknown; readonly type?: unknown };

    expect(schema.$id).toBe(expectedId);
    expect([
      undefined,
      "http://json-schema.org/draft-07/schema#",
      "https://json-schema.org/draft/2020-12/schema",
    ]).toContain(schema.$schema);
    expect(schema.type).toBe("object");
  });
});
