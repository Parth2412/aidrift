import {
  AIDriftError,
  ExitCode,
  resolveProbeProvider,
  type EvalProvider,
  type ProbeCostEstimate,
  type ProbeModelTarget,
} from "@aidrift/core";

export type LiveProviderId = "openai" | "anthropic";
export type ProbeProviderId = "mock" | LiveProviderId;

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
    docs: "docs/development/probe-costs.md",
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
      fix: `Set ${envVar} in your environment. See docs/development/probe-costs.md for setup and cost expectations.`,
      docs: "docs/development/probe-costs.md",
    });
  }
}

export function buildLiveProvider(
  providerId: LiveProviderId,
  models: readonly ProbeModelTarget[],
  env: Readonly<Record<string, string | undefined>>,
): EvalProvider {
  const model = models[0]?.model;
  if (model === undefined || model.trim().length === 0) {
    throw new AIDriftError({
      code: "probe.provider.model_required",
      exitCode: ExitCode.ConfigError,
      what: "Live provider probe requires at least one model in the manifest.",
      why: "The live provider must be configured with a model name.",
      fix: "Add a model artifact to .aistate.yml under artifacts.models.",
      docs: "docs/development/probe-costs.md",
    });
  }
  return resolveProbeProvider({ providerId, model, env });
}

export function parseCostBudget(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function enforceRunConfirmation(
  estimate: ProbeCostEstimate,
  yes: boolean | undefined,
  costBudget: string | undefined,
): void {
  if (yes === true) {
    return;
  }
  const budget = parseCostBudget(costBudget);
  if (budget === undefined) {
    throw new AIDriftError({
      code: "probe.confirmation.required",
      exitCode: ExitCode.ConfigError,
      what: "Live provider run requires explicit confirmation.",
      why: "Running probes against a live provider incurs real API costs.",
      fix: "Add --yes to confirm, or --cost-budget=<dollars> to cap spending.",
      docs: "docs/development/probe-costs.md",
    });
  }
  if (estimate.estimatedUsd > budget) {
    throw new AIDriftError({
      code: "probe.budget.exceeded",
      exitCode: ExitCode.ConfigError,
      what: `Estimated cost $${estimate.estimatedUsd.toFixed(6)} exceeds budget $${budget.toFixed(6)}.`,
      why: "The probe run would exceed the configured --cost-budget.",
      fix: "Increase --cost-budget or add --yes to ignore the cap.",
      docs: "docs/development/probe-costs.md",
    });
  }
}

export function formatCostEstimate(estimate: ProbeCostEstimate): string {
  return [
    "AIDRIFT Probe Cost Estimate",
    `Models: ${estimate.modelCount}`,
    `Probes per model: ${estimate.probeCount}`,
    `Samples per probe: ${estimate.samples}`,
    `Estimated requests: ${estimate.requestCount}`,
    `Estimated cost: $${estimate.estimatedUsd.toFixed(6)}`,
    "",
  ].join("\n");
}
