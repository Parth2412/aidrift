export interface AISystemOutput {
  readonly content: string;
  readonly toolCalls?: readonly unknown[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AssertionConfig {
  readonly id: string;
  readonly type: string;
  readonly input: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AssertionResult {
  readonly assertionId: string;
  readonly passed: boolean;
  readonly score: number;
  readonly confidence: number;
  readonly details: {
    readonly expected: string;
    readonly actual: string;
    readonly explanation: string;
  };
}

export interface AssertionEvaluator {
  readonly type: string;
  evaluate(
    input: string,
    output: AISystemOutput,
    config: AssertionConfig,
  ): Promise<AssertionResult>;
}
