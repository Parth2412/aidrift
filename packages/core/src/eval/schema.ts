import { SUPPORTED_ASSERTION_TYPES } from "./types.js";

export const ASSERTION_SUITE_SCHEMA = {
  $id: "https://aidrift.dev/schemas/assertions.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["suite", "assertions"],
  properties: {
    suite: { type: "string", minLength: 1 },
    description: { type: "string" },
    assertions: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/assertion" },
    },
  },
  $defs: {
    assertion: {
      type: "object",
      required: ["id", "type", "input"],
      properties: {
        id: { type: "string", minLength: 1, pattern: "^[A-Za-z0-9_.-]+$" },
        type: { enum: [...SUPPORTED_ASSERTION_TYPES] },
        description: { type: "string" },
        tags: {
          type: "array",
          items: { type: "string", minLength: 1 },
          uniqueItems: true,
        },
        critical: { type: "boolean" },
        input: { type: "string", minLength: 1 },
        expected_contains: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
        expected_not_contains: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
        pattern: { type: "string", minLength: 1 },
        flags: { type: "string" },
        expected_schema: { type: "object" },
      },
      additionalProperties: true,
      allOf: [
        {
          if: { properties: { type: { const: "contains" } } },
          then: {
            anyOf: [{ required: ["expected_contains"] }, { required: ["expected_not_contains"] }],
          },
        },
        {
          if: { properties: { type: { const: "regex" } } },
          then: { required: ["pattern"] },
        },
        {
          if: { properties: { type: { const: "json_schema" } } },
          then: { required: ["expected_schema"] },
        },
      ],
    },
  },
} as const;
