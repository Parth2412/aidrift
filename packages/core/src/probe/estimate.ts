import {
  lookupCostUsd,
  lookupModelPriceUsdPerMillion,
  PRICING_VERIFIED_ON,
} from "../providers/cost-tables.js";
import { BUILT_IN_PROBES } from "./canonical.js";
import { MAX_EVAL_EXECUTIONS, MAX_EVAL_SAMPLES, MAX_PROBE_MODELS } from "../eval/limits.js";
import type { CanonicalProbe, ProbeCostEstimate, ProbeModelTarget } from "./types.js";

const MESSAGE_FRAMING_TOKENS = 24;

export interface EstimateProbeCostOptions {
  readonly models: readonly ProbeModelTarget[];
  readonly samples?: number | undefined;
  readonly probeCount?: number | undefined;
  readonly probes?: readonly CanonicalProbe[] | undefined;
  /** Exact user inputs for non-canonical eval requests. */
  readonly requestInputs?: readonly string[] | undefined;
  /** System prompt or other repeated context, expressed as estimated tokens. */
  readonly inputTokenOverheadPerRequest?: number | undefined;
  readonly estimatedOutputTokensPerRequest?: number | undefined;
}

export function estimateProbeCost(options: EstimateProbeCostOptions): ProbeCostEstimate {
  const samples = options.samples ?? 5;
  const profiles = selectedProfiles(options);
  const probeCount = options.probeCount ?? options.requestInputs?.length ?? profiles.length;
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > MAX_EVAL_SAMPLES) {
    throw new RangeError(`samples must be between 1 and ${MAX_EVAL_SAMPLES}.`);
  }
  if (options.models.length > MAX_PROBE_MODELS) {
    throw new RangeError(`models must contain at most ${MAX_PROBE_MODELS} targets.`);
  }
  if (!Number.isSafeInteger(probeCount) || probeCount < 0) {
    throw new RangeError("probeCount must be a non-negative integer.");
  }
  if (options.requestInputs !== undefined && options.requestInputs.length !== probeCount) {
    throw new RangeError("requestInputs length must equal probeCount.");
  }
  if (options.probes !== undefined && options.probes.length !== probeCount) {
    throw new RangeError("probes length must equal probeCount.");
  }
  const repeatedInputOverhead = options.inputTokenOverheadPerRequest ?? 0;
  if (!Number.isSafeInteger(repeatedInputOverhead) || repeatedInputOverhead < 0) {
    throw new RangeError("inputTokenOverheadPerRequest must be a non-negative integer.");
  }
  const outputTokensPerRequest = options.estimatedOutputTokensPerRequest ?? 256;
  if (!Number.isSafeInteger(outputTokensPerRequest) || outputTokensPerRequest < 1) {
    throw new RangeError("estimatedOutputTokensPerRequest must be a positive integer.");
  }
  const requestCount = options.models.length * probeCount * samples;
  if (!Number.isSafeInteger(requestCount) || requestCount > MAX_EVAL_EXECUTIONS) {
    throw new RangeError(
      `Estimated workload must not exceed ${MAX_EVAL_EXECUTIONS} provider requests.`,
    );
  }
  const requestTokenProfiles = buildRequestTokenProfiles({
    profiles,
    probeCount,
    requestInputs: options.requestInputs,
    repeatedInputOverhead,
    outputTokensPerRequest,
  });

  let knownCost = 0;
  let estimatedInputTokens = 0;
  let aggregateOutputTokens = 0;
  const unknownModels: string[] = [];
  for (const model of options.models) {
    const outputCap = configuredOutputCap(model);
    const modelProfiles = requestTokenProfiles.map((profile) => ({
      inputTokens: profile.inputTokens,
      outputTokens:
        outputCap === undefined ? profile.outputTokens : Math.min(profile.outputTokens, outputCap),
    }));
    estimatedInputTokens +=
      modelProfiles.reduce((total, profile) => total + profile.inputTokens, 0) * samples;
    aggregateOutputTokens +=
      modelProfiles.reduce((total, profile) => total + profile.outputTokens, 0) * samples;
    if (model.provider === "mock") continue;
    const price = lookupModelPriceUsdPerMillion(model.provider, model.model);
    if (price === undefined) {
      unknownModels.push(`${model.name} (${model.provider}/${model.model})`);
      continue;
    }
    for (const usage of modelProfiles) {
      const requestCost = lookupCostUsd({
        providerId: model.provider,
        model: model.model,
        usage,
      });
      if (requestCost !== undefined) knownCost += requestCost * samples;
    }
  }

  return {
    modelCount: options.models.length,
    probeCount,
    samples,
    requestCount,
    estimatedInputTokens,
    estimatedOutputTokens: aggregateOutputTokens,
    ...(unknownModels.length === 0 ? { estimatedUsd: roundUsd(knownCost) } : {}),
    unknownModels: unknownModels.sort(),
    pricingAsOf: PRICING_VERIFIED_ON,
  };
}

function selectedProfiles(options: EstimateProbeCostOptions): readonly CanonicalProbe[] {
  if (options.probes !== undefined) return options.probes;
  if (options.probeCount === 0) return [];
  return BUILT_IN_PROBES;
}

function estimateInputTokens(probe: CanonicalProbe): number {
  return Math.ceil(Buffer.byteLength(probe.input, "utf8") / 4) + MESSAGE_FRAMING_TOKENS;
}

function estimatedProbeOutputTokens(probe: CanonicalProbe): number {
  switch (probe.category) {
    case "deterministic":
      return 12;
    case "structural":
      return 48;
    case "semantic":
      return 128;
    case "behavioral":
      return 112;
    case "performance":
      return 96;
  }
}

function configuredOutputCap(model: ProbeModelTarget): number | undefined {
  const value = model.parameters?.max_completion_tokens ?? model.parameters?.max_tokens;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

interface RequestTokenProfile {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface BuildRequestTokenProfilesOptions {
  readonly profiles: readonly CanonicalProbe[];
  readonly probeCount: number;
  readonly requestInputs: readonly string[] | undefined;
  readonly repeatedInputOverhead: number;
  readonly outputTokensPerRequest: number;
}

function buildRequestTokenProfiles(
  options: BuildRequestTokenProfilesOptions,
): readonly RequestTokenProfile[] {
  if (options.requestInputs !== undefined) {
    return options.requestInputs.map((input) => ({
      inputTokens:
        Math.ceil(Buffer.byteLength(input, "utf8") / 4) +
        MESSAGE_FRAMING_TOKENS +
        options.repeatedInputOverhead,
      outputTokens: options.outputTokensPerRequest,
    }));
  }
  if (options.profiles.length === options.probeCount) {
    return options.profiles.map((profile) => ({
      inputTokens: estimateInputTokens(profile) + options.repeatedInputOverhead,
      outputTokens: estimatedProbeOutputTokens(profile),
    }));
  }
  if (options.probeCount === 0 || options.profiles.length === 0) return [];
  const averageInputTokens = Math.ceil(
    options.profiles.reduce((total, profile) => total + estimateInputTokens(profile), 0) /
      options.profiles.length,
  );
  const averageOutputTokens = Math.ceil(
    options.profiles.reduce((total, profile) => total + estimatedProbeOutputTokens(profile), 0) /
      options.profiles.length,
  );
  return Array.from({ length: options.probeCount }, () => ({
    inputTokens: averageInputTokens + options.repeatedInputOverhead,
    outputTokens: averageOutputTokens,
  }));
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
