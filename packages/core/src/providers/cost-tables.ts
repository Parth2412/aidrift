export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LookupCostUsdOptions {
  readonly providerId: string;
  readonly model: string;
  readonly usage: ProviderUsage;
}

interface PerTokenPrice {
  readonly input: number;
  readonly output: number;
}

const PER_MILLION = 1 / 1_000_000;

const OPENAI_PRICES: Readonly<Record<string, PerTokenPrice>> = {
  "gpt-4o": { input: 2.5 * PER_MILLION, output: 10.0 * PER_MILLION },
  "gpt-4o-mini": { input: 0.15 * PER_MILLION, output: 0.6 * PER_MILLION },
  "gpt-4-turbo": { input: 10.0 * PER_MILLION, output: 30.0 * PER_MILLION },
  "gpt-4": { input: 30.0 * PER_MILLION, output: 60.0 * PER_MILLION },
  "gpt-3.5-turbo": { input: 0.5 * PER_MILLION, output: 1.5 * PER_MILLION },
};

const ANTHROPIC_PRICES: Readonly<Record<string, PerTokenPrice>> = {
  "claude-3-5-sonnet-latest": {
    input: 3.0 * PER_MILLION,
    output: 15.0 * PER_MILLION,
  },
  "claude-3-5-sonnet-20241022": {
    input: 3.0 * PER_MILLION,
    output: 15.0 * PER_MILLION,
  },
  "claude-3-5-haiku-latest": {
    input: 0.8 * PER_MILLION,
    output: 4.0 * PER_MILLION,
  },
  "claude-3-5-haiku-20241022": {
    input: 0.8 * PER_MILLION,
    output: 4.0 * PER_MILLION,
  },
  "claude-3-opus-latest": {
    input: 15.0 * PER_MILLION,
    output: 75.0 * PER_MILLION,
  },
  "claude-3-opus-20240229": {
    input: 15.0 * PER_MILLION,
    output: 75.0 * PER_MILLION,
  },
  "claude-3-haiku-20240307": {
    input: 0.25 * PER_MILLION,
    output: 1.25 * PER_MILLION,
  },
};

const PRICES_BY_PROVIDER: Readonly<Record<string, Readonly<Record<string, PerTokenPrice>>>> = {
  openai: OPENAI_PRICES,
  anthropic: ANTHROPIC_PRICES,
};

export function lookupCostUsd(options: LookupCostUsdOptions): number | undefined {
  const table = PRICES_BY_PROVIDER[options.providerId];
  if (table === undefined) {
    return undefined;
  }
  const price = table[options.model];
  if (price === undefined) {
    return undefined;
  }
  const inputCost = options.usage.inputTokens * price.input;
  const outputCost = options.usage.outputTokens * price.output;
  return inputCost + outputCost;
}
