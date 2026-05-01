export interface EvalProviderOutput {
  readonly content: string;
  readonly latencyMs: number;
  readonly raw?: unknown;
}

export interface EvalProviderRequest {
  readonly input: string;
  readonly assertionId?: string | undefined;
}

export interface EvalProvider {
  readonly id: string;
  generate(request: EvalProviderRequest): Promise<EvalProviderOutput>;
}

export type EvalAssertionStatus = "PASS" | "WARN" | "FAIL" | "NEW";

export interface EvalAssertionResult {
  readonly assertionId: string;
  readonly status: EvalAssertionStatus;
  readonly score: number;
  readonly baselineScore?: number | undefined;
  readonly explanation: string;
}
