import { runInNewContext } from "node:vm";

import safeRegex from "safe-regex2";

import { AIDriftError, ExitCode } from "../../errors.js";
import type { ProviderOutput } from "../../providers/types.js";
import type { RegexAssertion } from "../types.js";
import type { SingleAssertionEvaluation } from "../results.js";

const REGEX_EXECUTION_TIMEOUT_MS = 250;

export async function evaluateRegex(
  assertion: RegexAssertion,
  output: ProviderOutput,
): Promise<SingleAssertionEvaluation> {
  let pattern: RegExp;
  try {
    pattern = new RegExp(assertion.pattern, assertion.flags);
  } catch (cause) {
    throw regexEvaluationError(
      assertion,
      "The pattern is not a valid JavaScript regular expression.",
      cause,
    );
  }
  if (!safeRegex(pattern)) {
    throw regexEvaluationError(assertion, "The pattern may exhibit catastrophic backtracking.");
  }

  let passed: boolean;
  try {
    passed = runInNewContext(
      "pattern.test(content)",
      { pattern, content: output.content },
      {
        timeout: REGEX_EXECUTION_TIMEOUT_MS,
      },
    ) as boolean;
  } catch (cause) {
    throw regexEvaluationError(
      assertion,
      `Pattern execution did not complete safely within ${REGEX_EXECUTION_TIMEOUT_MS} ms.`,
      cause,
    );
  }

  return {
    passed,
    score: passed ? 1 : 0,
    expected: `matches /${assertion.pattern}/${assertion.flags ?? ""}`,
    actual: output.content,
    explanation: passed ? "Regex matched output." : "Regex did not match output.",
  };
}

function regexEvaluationError(
  assertion: RegexAssertion,
  reason: string,
  cause?: unknown,
): AIDriftError {
  return new AIDriftError({
    code: "assertion.regex.unsafe",
    exitCode: ExitCode.ConfigError,
    what: `Regex assertion "${assertion.id}" cannot be evaluated safely.`,
    why: reason,
    fix: "Use a valid bounded pattern without nested or repeated quantifiers.",
    docs: "https://github.com/Parth2412/aidrift#readme",
    cause,
  });
}
