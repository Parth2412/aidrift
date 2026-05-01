import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { evaluateAssertion } from "../../src/eval/evaluators/index.js";
import { loadEvalSuite } from "../../src/eval/loader.js";
import { describeAssertionExpected } from "../../src/eval/results.js";

describe("eval suite loader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-loader-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty suite for a missing suite directory", async () => {
    const suite = await loadEvalSuite({ suitePath: path.join(tmpDir, "missing") });

    expect(suite.assertions).toEqual([]);
    expect(suite.suite).toBe("missing");
  });

  it("loads and combines assertion files in stable filename order", async () => {
    const suiteDir = path.join(tmpDir, "evals");
    await fs.mkdir(suiteDir);
    await fs.writeFile(
      path.join(suiteDir, "b.assertions.yml"),
      suiteSource("b", "contains", 'expected_contains: ["mock:"]'),
      "utf8",
    );
    await fs.writeFile(
      path.join(suiteDir, "a.assertions.yml"),
      suiteSource("a", "contains", 'expected_contains: ["mock:"]'),
      "utf8",
    );

    const suite = await loadEvalSuite({ suitePath: suiteDir });

    expect(suite.assertions.map((assertion) => assertion.id)).toEqual(["a", "b"]);
  });

  it("throws a config error for invalid suite files", async () => {
    const suiteFile = path.join(tmpDir, "bad.assertions.yml");
    await fs.writeFile(suiteFile, "suite: bad\nassertions:\n  - type: contains\n", "utf8");

    await expect(loadEvalSuite({ suitePath: suiteFile })).rejects.toMatchObject({
      code: "assertion.schema.invalid",
      exitCode: 2,
    });
  });
});

describe("eval result helpers and dispatch", () => {
  it("describes regex and JSON Schema expectations", () => {
    expect(
      describeAssertionExpected({
        id: "regex",
        type: "regex",
        input: "",
        pattern: "^mock",
      }),
    ).toBe("pattern: ^mock");

    expect(
      describeAssertionExpected({
        id: "schema",
        type: "json_schema",
        input: "",
        expected_schema: { type: "object" },
      }),
    ).toBe("valid JSON matching expected_schema");
  });

  it("dispatches json_schema assertions through the shared evaluator", async () => {
    const result = await evaluateAssertion(
      {
        id: "schema",
        type: "json_schema",
        input: "",
        expected_schema: { type: "object" },
      },
      { content: "{}", latencyMs: 1 },
    );

    expect(result.passed).toBe(true);
  });
});

function suiteSource(id: string, type: string, body: string): string {
  return `suite: ${id}
assertions:
  - id: ${id}
    type: ${type}
    input: hello
    ${body}
`;
}
