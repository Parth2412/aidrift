import { AIDriftError, ExitCode } from "../../errors.js";
import type { ProviderOutput } from "../../providers/types.js";
import { compileJsonSchema } from "../json-schema-engine.js";
import type { SingleAssertionEvaluation } from "../results.js";
import type { JsonSchemaAssertion } from "../types.js";

const MAX_JSON_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_JSON_OUTPUT_NODES = 50_000;
const MAX_JSON_OUTPUT_DEPTH = 64;
const MAX_JSON_ARRAY_ITEMS = 1_000;
const MAX_JSON_OBJECT_PROPERTIES = 10_000;

export async function evaluateJsonSchema(
  assertion: JsonSchemaAssertion,
  output: ProviderOutput,
): Promise<SingleAssertionEvaluation> {
  if (Buffer.byteLength(output.content, "utf8") > MAX_JSON_OUTPUT_BYTES) {
    throw jsonSchemaEvaluationError(
      assertion,
      `Output exceeds the ${MAX_JSON_OUTPUT_BYTES}-byte validation limit.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output.content);
  } catch {
    return {
      passed: false,
      score: 0,
      expected: "valid JSON matching expected_schema",
      actual: output.content,
      explanation: "Output is not valid JSON.",
    };
  }

  assertJsonOutputComplexity(assertion, parsed);
  let validate;
  try {
    validate = compileJsonSchema(assertion.expected_schema);
  } catch (cause) {
    throw jsonSchemaEvaluationError(assertion, "The expected schema is invalid or unsafe.", cause);
  }

  let passed: boolean;
  try {
    passed = validate(parsed) as boolean;
  } catch (cause) {
    throw jsonSchemaEvaluationError(assertion, "Schema evaluation failed safely.", cause);
  }

  return {
    passed,
    score: passed ? 1 : 0,
    expected: "valid JSON matching expected_schema",
    actual: output.content,
    explanation: passed
      ? "Output matched JSON schema."
      : `Output failed schema validation: ${schemaErrorsText(validate.errors)}.`,
  };
}

function assertJsonOutputComplexity(assertion: JsonSchemaAssertion, root: unknown): void {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value: root, depth: 0 },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_OUTPUT_NODES) {
      throw jsonSchemaEvaluationError(
        assertion,
        `Output exceeds the ${MAX_JSON_OUTPUT_NODES}-node validation limit.`,
      );
    }
    if (current.depth > MAX_JSON_OUTPUT_DEPTH) {
      throw jsonSchemaEvaluationError(
        assertion,
        `Output exceeds the ${MAX_JSON_OUTPUT_DEPTH}-level validation depth limit.`,
      );
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_JSON_ARRAY_ITEMS) {
        throw jsonSchemaEvaluationError(
          assertion,
          `Output array exceeds the ${MAX_JSON_ARRAY_ITEMS}-item validation limit.`,
        );
      }
      for (const value of current.value) stack.push({ value, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      const values = Object.values(current.value);
      if (values.length > MAX_JSON_OBJECT_PROPERTIES) {
        throw jsonSchemaEvaluationError(
          assertion,
          `Output object exceeds the ${MAX_JSON_OBJECT_PROPERTIES}-property validation limit.`,
        );
      }
      for (const value of values) stack.push({ value, depth: current.depth + 1 });
    }
  }
}

function schemaErrorsText(
  errors:
    | null
    | readonly { readonly instancePath?: string; readonly message?: string }[]
    | undefined,
): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join(", ");
}

function jsonSchemaEvaluationError(
  assertion: JsonSchemaAssertion,
  reason: string,
  cause?: unknown,
): AIDriftError {
  return new AIDriftError({
    code: "assertion.json_schema.unsafe",
    exitCode: ExitCode.ConfigError,
    what: `JSON Schema assertion "${assertion.id}" cannot be evaluated safely.`,
    why: reason,
    fix: "Reduce output/schema complexity and use local references with RE2-compatible patterns.",
    docs: "https://github.com/Parth2412/aidrift#readme",
    cause,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
