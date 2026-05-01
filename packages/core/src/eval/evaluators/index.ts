import type { ProviderOutput } from "../../providers/types.js";
import type { Assertion } from "../types.js";
import type { SingleAssertionEvaluation } from "../results.js";
import { evaluateContains } from "./contains.js";
import { evaluateJsonSchema } from "./json-schema.js";
import { evaluateRegex } from "./regex.js";

export async function evaluateAssertion(
  assertion: Assertion,
  output: ProviderOutput,
): Promise<SingleAssertionEvaluation> {
  if (assertion.type === "contains") {
    return evaluateContains(assertion, output);
  }

  if (assertion.type === "regex") {
    return evaluateRegex(assertion, output);
  }

  return evaluateJsonSchema(assertion, output);
}
