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

  it("rejects unavailable assertion types with a version-neutral error", () => {
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
        code: "assertion.type.unsupported",
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

  it("rejects regex patterns susceptible to catastrophic backtracking", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/unsafe-regex.assertions.yml",
      source: `
suite: unsafe-regex
assertions:
  - id: unsafe
    type: regex
    input: "hello"
    pattern: "(a+)+$"
`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "assertion.regex.unsafe",
        assertionId: "unsafe",
      }),
    );
  });

  it("rejects unknown and cross-type assertion properties", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/strict.assertions.yml",
      source: `suite: strict
assertions:
  - id: typo
    type: contains
    input: hello
    expected_contains: [hello]
    threshold: 0.8
  - id: crossed
    type: regex
    input: hello
    pattern: hello
    expected_contains: [hello]
`,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "assertion.property.unsupported",
          assertionId: "typo",
        }),
        expect.objectContaining({
          code: "assertion.property.unsupported",
          assertionId: "crossed",
        }),
      ]),
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

  it("rejects external references and non-RE2 JSON Schema patterns", () => {
    const externalReference = parseEvalSuiteSource({
      suitePath: "evals/external-schema.assertions.yml",
      source: `
suite: external-schema
assertions:
  - id: external
    type: json_schema
    input: "json"
    expected_schema:
      $ref: "https://example.test/schema.json"
`,
    });
    const unsupportedPattern = parseEvalSuiteSource({
      suitePath: "evals/pattern-schema.assertions.yml",
      source: `
suite: pattern-schema
assertions:
  - id: lookahead
    type: json_schema
    input: "json"
    expected_schema:
      type: string
      pattern: "(?=a)a"
`,
    });

    expect(externalReference.errors).toContainEqual(
      expect.objectContaining({ code: "assertion.json_schema.invalid" }),
    );
    expect(unsupportedPattern.errors).toContainEqual(
      expect.objectContaining({ code: "assertion.json_schema.invalid" }),
    );
  });

  it("accepts formerly catastrophic JSON Schema patterns through the linear-time engine", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/linear-schema.assertions.yml",
      source: `
suite: linear-schema
assertions:
  - id: linear
    type: json_schema
    input: "json"
    expected_schema:
      type: string
      pattern: "(a+)+$"
`,
    });

    expect(result.valid).toBe(true);
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

  it("rejects YAML alias expansion above the resource limit", () => {
    const aliases = `
a: &a [x, x, x, x, x, x, x, x, x, x]
b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]
c: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]
`;
    const result = parseEvalSuiteSource({
      suitePath: "evals/aliases.assertions.yml",
      source: aliases,
    });

    expect(result).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: "assertion.yaml.invalid" })],
    });
  });

  it("rejects credentials embedded in assertion inputs", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/secret.assertions.yml",
      source: `
suite: secret
assertions:
  - id: leaked
    type: contains
    input: "use npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
    expected_contains: [ok]
`,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "assertion.secret.disallowed" }),
    );
  });

  it("rejects deeply nested assertion values before schema validation", () => {
    const result = parseEvalSuiteSource({
      suitePath: "evals/deep.assertions.yml",
      source: `deep: ${"[".repeat(70)}value${"]".repeat(70)}\n`,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "assertion.complexity.exceeded" }),
    );
  });
});
