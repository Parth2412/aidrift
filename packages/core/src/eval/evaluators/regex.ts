import type { ProviderOutput } from "../../providers/types.js";
import type { RegexAssertion } from "../types.js";
import type { SingleAssertionEvaluation } from "../results.js";

export async function evaluateRegex(
  assertion: RegexAssertion,
  output: ProviderOutput,
): Promise<SingleAssertionEvaluation> {
  const pattern = new RegExp(assertion.pattern, assertion.flags);
  const passed = pattern.test(output.content);

  return {
    passed,
    score: passed ? 1 : 0,
    expected: `matches /${assertion.pattern}/${assertion.flags ?? ""}`,
    actual: output.content,
    explanation: passed ? "Regex matched output." : "Regex did not match output.",
  };
}
