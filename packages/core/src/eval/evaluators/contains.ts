import type { ProviderOutput } from "../../providers/types.js";
import type { ContainsAssertion } from "../types.js";
import type { SingleAssertionEvaluation } from "../results.js";

export async function evaluateContains(
  assertion: ContainsAssertion,
  output: ProviderOutput,
): Promise<SingleAssertionEvaluation> {
  const required = assertion.expected_contains ?? [];
  const forbidden = assertion.expected_not_contains ?? [];
  const missing = required.filter((expected) => !output.content.includes(expected));
  const presentForbidden = forbidden.filter((expected) => output.content.includes(expected));
  const passed = missing.length === 0 && presentForbidden.length === 0;

  return {
    passed,
    score: passed ? 1 : 0,
    expected: [
      required.length === 0 ? undefined : `contains ${required.join(", ")}`,
      forbidden.length === 0 ? undefined : `excludes ${forbidden.join(", ")}`,
    ]
      .filter((item): item is string => item !== undefined)
      .join("; "),
    actual: output.content,
    explanation: passed
      ? "All contains checks passed."
      : [
          missing.length === 0 ? undefined : `missing: ${missing.join(", ")}`,
          presentForbidden.length === 0 ? undefined : `forbidden: ${presentForbidden.join(", ")}`,
        ]
          .filter((item): item is string => item !== undefined)
          .join("; "),
  };
}
