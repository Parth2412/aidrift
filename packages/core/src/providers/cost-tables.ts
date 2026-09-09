export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LookupCostUsdOptions {
  readonly providerId: string;
  readonly model: string;
  readonly usage: ProviderUsage;
}

export interface ModelPriceUsdPerMillion {
  readonly input: number;
  readonly output: number;
  readonly source: string;
  readonly verifiedOn: string;
  readonly longContextThresholdInputTokens?: number | undefined;
  readonly longContextInputMultiplier?: number | undefined;
  readonly longContextOutputMultiplier?: number | undefined;
}

export const PRICING_VERIFIED_ON = "2026-09-08";
const OPENAI_SOURCE = "https://developers.openai.com/api/docs/models";
const ANTHROPIC_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

const OPENAI_PRICES: Readonly<
  Record<string, Omit<ModelPriceUsdPerMillion, "source" | "verifiedOn">>
> = {
  "gpt-5.6-sol": {
    input: 4,
    output: 20,
    longContextThresholdInputTokens: 272_000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
  },
  "gpt-5.6": {
    input: 4,
    output: 20,
    longContextThresholdInputTokens: 272_000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
  },
  "gpt-5.6-terra": {
    input: 2,
    output: 12,
    longContextThresholdInputTokens: 272_000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
  },
  "gpt-5.6-luna": {
    input: 0.2,
    output: 1.2,
    longContextThresholdInputTokens: 272_000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
  },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-2025-08-07": { input: 1.25, output: 10 },
  "gpt-5-chat-latest": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-mini-2025-08-07": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5-nano-2025-08-07": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-2025-04-14": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-mini-2025-04-14": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1-nano-2025-04-14": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-2024-05-13": { input: 2.5, output: 10 },
  "gpt-4o-2024-08-06": { input: 2.5, output: 10 },
  "gpt-4o-2024-11-20": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6 },
};

const ANTHROPIC_PRICES: Readonly<
  Record<string, Omit<ModelPriceUsdPerMillion, "source" | "verifiedOn">>
> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5-20251101": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

export function lookupModelPriceUsdPerMillion(
  providerId: string,
  model: string,
): ModelPriceUsdPerMillion | undefined {
  const raw =
    providerId === "openai"
      ? OPENAI_PRICES[model]
      : providerId === "anthropic"
        ? ANTHROPIC_PRICES[model]
        : undefined;
  if (raw === undefined) return undefined;
  return {
    ...raw,
    source: providerId === "openai" ? OPENAI_SOURCE : ANTHROPIC_SOURCE,
    verifiedOn: PRICING_VERIFIED_ON,
  };
}

export function lookupCostUsd(options: LookupCostUsdOptions): number | undefined {
  const price = lookupModelPriceUsdPerMillion(options.providerId, options.model);
  if (price === undefined) return undefined;
  const longContext =
    price.longContextThresholdInputTokens !== undefined &&
    options.usage.inputTokens > price.longContextThresholdInputTokens;
  const inputMultiplier = longContext ? (price.longContextInputMultiplier ?? 1) : 1;
  const outputMultiplier = longContext ? (price.longContextOutputMultiplier ?? 1) : 1;
  return (
    (options.usage.inputTokens * price.input * inputMultiplier +
      options.usage.outputTokens * price.output * outputMultiplier) /
    1_000_000
  );
}
