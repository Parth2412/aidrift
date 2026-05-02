import { BUILT_IN_PROBES } from "./canonical.js";
import type { ProbeCostEstimate, ProbeModelTarget } from "./types.js";

const DEFAULT_ESTIMATED_REQUEST_COST_USD = 0.0002;

export interface EstimateProbeCostOptions {
  readonly models: readonly ProbeModelTarget[];
  readonly samples?: number | undefined;
  readonly probeCount?: number | undefined;
}

export function estimateProbeCost(options: EstimateProbeCostOptions): ProbeCostEstimate {
  const samples = Math.max(1, options.samples ?? 5);
  const probeCount = options.probeCount ?? BUILT_IN_PROBES.length;
  const requestCount = options.models.length * probeCount * samples;

  return {
    modelCount: options.models.length,
    probeCount,
    samples,
    requestCount,
    estimatedUsd: roundUsd(requestCount * DEFAULT_ESTIMATED_REQUEST_COST_USD),
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
