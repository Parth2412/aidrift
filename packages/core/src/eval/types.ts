export const SUPPORTED_ASSERTION_TYPES = ["contains", "regex", "json_schema"] as const;

export const DEFERRED_ASSERTION_TYPES = [
  "llm_judge",
  "tool_call",
  "latency",
  "cost",
  "semantic_stability",
  "custom",
] as const;

export type SupportedAssertionType = (typeof SUPPORTED_ASSERTION_TYPES)[number];
export type DeferredAssertionType = (typeof DEFERRED_ASSERTION_TYPES)[number];
export type AssertionType = SupportedAssertionType | DeferredAssertionType;

export interface AssertionBase {
  readonly id: string;
  readonly type: AssertionType;
  readonly description?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly critical?: boolean | undefined;
  readonly input: string;
}

export interface ContainsAssertion extends AssertionBase {
  readonly type: "contains";
  readonly expected_contains?: readonly string[] | undefined;
  readonly expected_not_contains?: readonly string[] | undefined;
}

export interface RegexAssertion extends AssertionBase {
  readonly type: "regex";
  readonly pattern: string;
  readonly flags?: string | undefined;
}

export interface JsonSchemaAssertion extends AssertionBase {
  readonly type: "json_schema";
  readonly expected_schema: Record<string, unknown>;
}

export type Assertion = ContainsAssertion | RegexAssertion | JsonSchemaAssertion;

export interface EvalSuite {
  readonly suite: string;
  readonly description?: string | undefined;
  readonly assertions: readonly Assertion[];
  readonly sourcePath?: string | undefined;
}

export type EvalIssueSeverity = "error" | "warning";

export interface EvalIssue {
  readonly severity: EvalIssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly suitePath?: string | undefined;
  readonly assertionId?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly fix?: string | undefined;
}

export interface SuiteParseResult {
  readonly valid: boolean;
  readonly suite?: EvalSuite | undefined;
  readonly errors: readonly EvalIssue[];
  readonly warnings: readonly EvalIssue[];
}

export type AssertionStatus = "PASS" | "WARN" | "FAIL" | "NEW";

export interface AssertionBaseline {
  readonly score: number;
  readonly capturedAt: string;
  readonly snapshotId?: string | undefined;
}

export type AssertionBaselineMap = Readonly<Record<string, AssertionBaseline>>;

export interface AssertionEvalResult {
  readonly assertionId: string;
  readonly type: AssertionType;
  readonly status: AssertionStatus;
  readonly score: number;
  readonly baselineScore?: number | undefined;
  readonly delta?: number | undefined;
  readonly providerId: string;
  readonly latencyMs: number;
  readonly tags: readonly string[];
  readonly critical: boolean;
  readonly explanation: string;
  readonly expected?: string | undefined;
  readonly actual?: string | undefined;
  readonly allowedRegression?: boolean | undefined;
}

export interface PlanRunSummary {
  readonly total: number;
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly new: number;
  readonly regressions: number;
}

export interface PlanRunResult {
  readonly suitePath: string;
  readonly providerId: string;
  readonly baselineSnapshotId?: string | undefined;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly dryRun: boolean;
  readonly results: readonly AssertionEvalResult[];
  readonly summary: PlanRunSummary;
  readonly hasRegressions: boolean;
}

export function isDeferredAssertionType(value: string): value is DeferredAssertionType {
  return (DEFERRED_ASSERTION_TYPES as readonly string[]).includes(value);
}

export function isSupportedAssertionType(value: string): value is SupportedAssertionType {
  return (SUPPORTED_ASSERTION_TYPES as readonly string[]).includes(value);
}
