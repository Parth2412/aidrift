import type { Assertion, AssertionEvalResult, PlanRunSummary } from "./types.js";

export interface SingleAssertionEvaluation {
  readonly passed: boolean;
  readonly score: number;
  readonly explanation: string;
  readonly expected: string;
  readonly actual: string;
}

export function summarizeResults(results: readonly AssertionEvalResult[]): PlanRunSummary {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === "PASS").length,
    warned: results.filter((result) => result.status === "WARN").length,
    failed: results.filter((result) => result.status === "FAIL").length,
    new: results.filter((result) => result.status === "NEW").length,
    regressions: results.filter((result) => result.status === "FAIL").length,
  };
}

export function describeAssertionExpected(assertion: Assertion): string {
  if (assertion.type === "contains") {
    return [
      assertion.expected_contains === undefined
        ? undefined
        : `contains: ${assertion.expected_contains.join(", ")}`,
      assertion.expected_not_contains === undefined
        ? undefined
        : `not contains: ${assertion.expected_not_contains.join(", ")}`,
    ]
      .filter((item): item is string => item !== undefined)
      .join("; ");
  }

  if (assertion.type === "regex") {
    return `pattern: ${assertion.pattern}`;
  }

  return "valid JSON matching expected_schema";
}
