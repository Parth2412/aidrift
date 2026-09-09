import { describe, expect, it } from "vitest";

import { evaluateContains } from "../../src/eval/evaluators/contains.js";
import { evaluateJsonSchema } from "../../src/eval/evaluators/json-schema.js";
import { evaluateRegex } from "../../src/eval/evaluators/regex.js";
import type { ProviderOutput } from "../../src/providers/types.js";

function providerOutput(content: string): ProviderOutput {
  return { content, latencyMs: 1 };
}

describe("contains evaluator", () => {
  it("passes when all required strings are present", async () => {
    const result = await evaluateContains(
      { id: "contains-pass", type: "contains", input: "", expected_contains: ["30 days", "cafe"] },
      providerOutput("Full refund for 30 days at the cafe."),
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when required strings are absent", async () => {
    const result = await evaluateContains(
      { id: "contains-fail", type: "contains", input: "", expected_contains: ["refund"] },
      providerOutput(""),
    );

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain("missing");
  });

  it("fails when excluded strings are present", async () => {
    const result = await evaluateContains(
      {
        id: "contains-excluded",
        type: "contains",
        input: "",
        expected_contains: ["refund"],
        expected_not_contains: ["store credit only"],
      },
      providerOutput("refund available as store credit only"),
    );

    expect(result.passed).toBe(false);
    expect(result.explanation).toContain("forbidden");
  });
});

describe("regex evaluator", () => {
  it("passes when the pattern matches", async () => {
    const result = await evaluateRegex(
      { id: "regex-pass", type: "regex", input: "", pattern: "^ord-[a-z0-9]{4}$", flags: "i" },
      providerOutput("ORD-A1B2"),
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when the pattern does not match an empty output", async () => {
    const result = await evaluateRegex(
      { id: "regex-empty", type: "regex", input: "", pattern: "^ORD-" },
      providerOutput(""),
    );

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it("handles unicode patterns", async () => {
    const result = await evaluateRegex(
      { id: "regex-unicode", type: "regex", input: "", pattern: "cafe", flags: "iu" },
      providerOutput("CAFE"),
    );

    expect(result.passed).toBe(true);
  });

  it("rejects unsafe patterns when the evaluator is called directly", async () => {
    await expect(
      evaluateRegex(
        { id: "regex-unsafe", type: "regex", input: "", pattern: "(a+)+$" },
        providerOutput(`${"a".repeat(100_000)}!`),
      ),
    ).rejects.toMatchObject({ code: "assertion.regex.unsafe", exitCode: 2 });
  });
});

describe("json_schema evaluator", () => {
  it("passes when output JSON matches the schema", async () => {
    const result = await evaluateJsonSchema(
      {
        id: "schema-pass",
        type: "json_schema",
        input: "",
        expected_schema: {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
      },
      providerOutput('{"ok":true}'),
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when output JSON does not match the schema", async () => {
    const result = await evaluateJsonSchema(
      {
        id: "schema-fail",
        type: "json_schema",
        input: "",
        expected_schema: {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
      },
      providerOutput('{"ok":"yes"}'),
    );

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain("schema");
  });

  it("fails when output is not JSON", async () => {
    const result = await evaluateJsonSchema(
      {
        id: "schema-invalid-json",
        type: "json_schema",
        input: "",
        expected_schema: { type: "object" },
      },
      providerOutput("not json"),
    );

    expect(result.passed).toBe(false);
    expect(result.explanation).toContain("valid JSON");
  });

  it("evaluates nested quantifiers in JSON Schema patterns without backtracking", async () => {
    const result = await evaluateJsonSchema(
      {
        id: "schema-linear-regex",
        type: "json_schema",
        input: "",
        expected_schema: { type: "string", pattern: "(a+)+$" },
      },
      providerOutput(JSON.stringify(`${"a".repeat(100_000)}!`)),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects provider JSON arrays above the validation complexity limit", async () => {
    await expect(
      evaluateJsonSchema(
        {
          id: "schema-large-array",
          type: "json_schema",
          input: "",
          expected_schema: { type: "array" },
        },
        providerOutput(JSON.stringify(Array.from({ length: 1_001 }, () => 1))),
      ),
    ).rejects.toMatchObject({ code: "assertion.json_schema.unsafe", exitCode: 2 });
  });
});
