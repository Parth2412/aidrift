import { describe, expect, it } from "vitest";

import { parseEvalSuiteSource } from "../../src/eval/parser.js";

describe("eval suite parser", () => {
  it("accepts a valid suite with supported assertion types", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/basic.assertions.yml",
      source: `
suite: basic
assertions:
  - id: greeting
    type: contains
    input: "hello"
    expected_contains: ["mock"]
  - id: order_id
    type: regex
    input: "order"
    pattern: "^mock:"
  - id: structured
    type: json_schema
    input: "json"
    expected_schema:
      type: object
      required: [ok]
      properties:
        ok:
          type: boolean
`,
    });

    expect(result.valid).toBe(true);
    expect(result.suite?.assertions.map((assertion) => assertion.id)).toEqual([
      "greeting",
      "order_id",
      "structured",
    ]);
  });

  it("reports missing assertion ids", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/missing.assertions.yml",
      source: `
suite: missing-id
assertions:
  - type: contains
    input: "hello"
    expected_contains: ["hello"]
`,
    });

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.message.includes('Missing required field "id"')),
    ).toBe(true);
  });

  it("rejects duplicate assertion ids", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/dupe.assertions.yml",
      source: `
suite: duplicate
assertions:
  - id: same
    type: contains
    input: "one"
    expected_contains: ["one"]
  - id: same
    type: regex
    input: "two"
    pattern: "two"
`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "assertion.id.duplicate",
        assertionId: "same",
      }),
    );
  });

  it("rejects deferred assertion types with the phase 9 code", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/deferred.assertions.yml",
      source: `
suite: deferred
assertions:
  - id: judged
    type: llm_judge
    input: "hello"
    judge:
      criteria: "friendly"
`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "assertion.type.unsupported_in_phase_9",
        assertionId: "judged",
      }),
    );
  });

  it("reports missing required fields per assertion type", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/invalid.assertions.yml",
      source: `
suite: invalid
assertions:
  - id: no-pattern
    type: regex
    input: "hello"
`,
    });

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.message.includes('Missing required field "pattern"')),
    ).toBe(true);
  });

  it("rejects invalid regex patterns", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/bad-regex.assertions.yml",
      source: `
suite: bad-regex
assertions:
  - id: bad
    type: regex
    input: "hello"
    pattern: "["
`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "assertion.regex.invalid",
        assertionId: "bad",
      }),
    );
  });

  it("rejects invalid JSON Schema definitions", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/bad-schema.assertions.yml",
      source: `
suite: bad-schema
assertions:
  - id: bad
    type: json_schema
    input: "json"
    expected_schema:
      type: nope
`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "assertion.json_schema.invalid",
        assertionId: "bad",
      }),
    );
  });

  it("reports bad YAML with line numbers", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/bad-yaml.assertions.yml",
      source: "suite: bad\nassertions:\n  - id: broken\n    type: contains\n    input: [\n",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({
        code: "assertion.yaml.invalid",
        line: expect.any(Number) as number,
        column: expect.any(Number) as number,
      }),
    );
  });
});
