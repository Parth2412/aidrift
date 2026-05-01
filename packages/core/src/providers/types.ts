export interface ProviderGenerateRequest {
  readonly input: string;
  readonly assertionId?: string | undefined;
}

export interface ProviderOutput {
  readonly content: string;
  readonly latencyMs: number;
  readonly raw?: unknown;
}

export interface EvalProvider {
  readonly id: string;
  generate(request: ProviderGenerateRequest): Promise<ProviderOutput>;
}
