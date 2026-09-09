export interface ProviderGenerateRequest {
  readonly input: string;
  readonly assertionId?: string | undefined;
  readonly probeId?: string | undefined;
  readonly modelName?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ProviderOutput {
  readonly content: string;
  readonly latencyMs: number;
  readonly costUsd?: number | undefined;
  readonly raw?: unknown;
}

export interface EvalProvider {
  readonly id: string;
  generate(request: ProviderGenerateRequest): Promise<ProviderOutput>;
}
