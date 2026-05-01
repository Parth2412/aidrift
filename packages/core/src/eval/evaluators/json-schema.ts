import { Ajv2020 } from "ajv/dist/2020.js";

import type { ProviderOutput } from "../../providers/types.js";
import type { JsonSchemaAssertion } from "../types.js";
import type { SingleAssertionEvaluation } from "../results.js";

export async function evaluateJsonSchema(
  assertion: JsonSchemaAssertion,
  output: ProviderOutput,
): Promise<SingleAssertionEvaluation> {
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

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(assertion.expected_schema);
  const passed = validate(parsed);

  return {
    passed,
    score: passed ? 1 : 0,
    expected: "valid JSON matching expected_schema",
    actual: output.content,
    explanation: passed
      ? "Output matched JSON schema."
      : `Output failed schema validation: ${ajv.errorsText(validate.errors)}.`,
  };
}
