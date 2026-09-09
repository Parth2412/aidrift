import {
  AIDriftError,
  ExitCode,
  resolveProbeProvider,
  type EvalProvider,
  type ProbeCostEstimate,
  type ProbeModelTarget,
} from "@zettacore/aidrift-core";

export type LiveProviderId = "openai" | "anthropic";
export type ProbeProviderId = "mock" | LiveProviderId;

export interface BuildLiveProviderOptions {
  readonly systemPrompt?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

const LIVE_PROVIDER_ENV_VARS: Readonly<Record<LiveProviderId, string>> = {
  openai: "AIDRIFT_OPENAI_API_KEY",
  anthropic: "AIDRIFT_ANTHROPIC_API_KEY",
};

export function parseProviderId(value: string | undefined): ProbeProviderId {
  const id = (value ?? "mock").trim();
  if (id === "mock" || id === "openai" || id === "anthropic") {
    return id as ProbeProviderId;
  }
  throw new AIDriftError({
    code: "probe.provider.invalid",
    exitCode: ExitCode.ConfigError,
    what: `Unknown provider: ${id}.`,
    why: "The requested provider is not supported for drift probes.",
    fix: "Provider must be one of mock, openai, anthropic.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

export function checkProviderEnvVar(
  providerId: LiveProviderId,
  env: Readonly<Record<string, string | undefined>>,
): void {
  const envVar = LIVE_PROVIDER_ENV_VARS[providerId];
  const value = env[envVar];
  if (value === undefined || value.trim().length === 0) {
    throw new AIDriftError({
      code: "probe.provider.auth_missing",
      exitCode: ExitCode.ConfigError,
      what: `Missing required environment variable ${envVar}.`,
      why: `Live probe runs for provider ${providerId} require an API key.`,
      fix: `Set ${envVar} in your environment and review the repository documentation for setup and cost expectations.`,
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
}

export function buildLiveProvider(
  providerId: LiveProviderId,
  model: ProbeModelTarget,
  env: Readonly<Record<string, string | undefined>>,
  options: BuildLiveProviderOptions = {},
): EvalProvider {
  if (model.model.trim().length === 0) {
    throw new AIDriftError({
      code: "probe.provider.model_required",
      exitCode: ExitCode.ConfigError,
      what: `Live provider probe requires a model id for artifact ${model.name}.`,
      why: "The live provider must be configured with a model name.",
      fix: "Add a model artifact to .aistate.yml under artifacts.models.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  if (model.provider !== providerId) {
    throw new AIDriftError({
      code: "probe.provider.model_mismatch",
      exitCode: ExitCode.ConfigError,
      what: `Model artifact ${model.name} declares provider ${model.provider}, not ${providerId}.`,
      why: "Overriding a model with a different provider would produce mislabeled drift evidence.",
      fix: `Use --provider ${model.provider} with a supported provider, or correct the model artifact.`,
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return resolveProbeProvider({
    providerId,
    model: model.model,
    env,
    ...(model.parameters !== undefined ? { parameters: model.parameters } : {}),
    ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}

export function parseCostBudget(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().replace(/^\$/u, "");
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) {
    throw invalidBudgetError();
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw invalidBudgetError();
  }
  return parsed;
}

export function enforceRunConfirmation(
  estimate: ProbeCostEstimate,
  yes: boolean | undefined,
  costBudget: string | undefined,
): void {
  const budget = parseCostBudget(costBudget);
  if (budget !== undefined && estimate.estimatedUsd === undefined) {
    throw new AIDriftError({
      code: "probe.cost.unknown",
      exitCode: ExitCode.ConfigError,
      what: "The live provider cost cannot be estimated for every selected model.",
      why: `No verified price is available for: ${estimate.unknownModels.join(", ")}.`,
      fix: "Use a model with verified pricing or remove --cost-budget and pass --yes to accept an unpriced live run.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  if (
    budget !== undefined &&
    estimate.estimatedUsd !== undefined &&
    estimate.estimatedUsd > budget
  ) {
    throw new AIDriftError({
      code: "probe.budget.exceeded",
      exitCode: ExitCode.ConfigError,
      what: `Estimated cost $${estimate.estimatedUsd.toFixed(6)} exceeds budget $${budget.toFixed(6)}.`,
      why: "The probe run would exceed the configured --cost-budget.",
      fix: "Increase --cost-budget or reduce models, probes, or samples.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  if (yes === true || budget !== undefined) return;
  throw new AIDriftError({
    code: "probe.confirmation.required",
    exitCode: ExitCode.ConfigError,
    what: "Live provider run requires explicit confirmation.",
    why: "Running probes against a live provider incurs real API costs.",
    fix: "Add --yes to confirm, or --cost-budget=<dollars> to cap spending.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

export function formatCostEstimate(estimate: ProbeCostEstimate): string {
  return [
    "AIDRIFT Probe Cost Estimate",
    `Models: ${estimate.modelCount}`,
    `Probes per model: ${estimate.probeCount}`,
    `Samples per probe: ${estimate.samples}`,
    `Estimated requests: ${estimate.requestCount}`,
    `Estimated input tokens: ${estimate.estimatedInputTokens}`,
    `Estimated output tokens: ${estimate.estimatedOutputTokens}`,
    `Pricing verified: ${estimate.pricingAsOf}`,
    estimate.estimatedUsd === undefined
      ? `Estimated cost: unknown (${estimate.unknownModels.join(", ")})`
      : `Estimated cost: $${estimate.estimatedUsd.toFixed(6)}`,
    "",
  ].join("\n");
}

export function formatCostEstimateJson(estimate: ProbeCostEstimate): string {
  return `${JSON.stringify(
    {
      schemaVersion: "cost-estimate.v1",
      modelCount: estimate.modelCount,
      probeCount: estimate.probeCount,
      samples: estimate.samples,
      requestCount: estimate.requestCount,
      estimatedInputTokens: estimate.estimatedInputTokens,
      estimatedOutputTokens: estimate.estimatedOutputTokens,
      pricingAsOf: estimate.pricingAsOf,
      ...(estimate.estimatedUsd === undefined
        ? { costEstimateKnown: false, unknownModels: estimate.unknownModels }
        : { costEstimateKnown: true, estimatedCostUsd: estimate.estimatedUsd }),
    },
    null,
    2,
  )}\n`;
}

function invalidBudgetError(): AIDriftError {
  return new AIDriftError({
    code: "probe.budget.invalid",
    exitCode: ExitCode.ConfigError,
    what: "The --cost-budget value is invalid.",
    why: "A cost budget must be a finite non-negative USD amount.",
    fix: "Pass a value such as --cost-budget=0.25.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}
