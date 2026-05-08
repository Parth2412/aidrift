import { createHash } from "node:crypto";

import type { CanonicalProbe, ProbeBaseline, ProbeStatus } from "./types.js";

export interface ProbeComparison {
  readonly status: ProbeStatus;
  readonly score: number;
  readonly confidence: number;
  readonly explanation: string;
}

export function compareProbeOutput(
  probe: CanonicalProbe,
  output: string,
  baseline: ProbeBaseline | undefined,
): ProbeComparison {
  if (baseline === undefined) {
    return {
      status: "NEW",
      score: 1,
      confidence: 0,
      explanation: "No baseline exists in the latest snapshot.",
    };
  }

  const score = scoreOutputSimilarity(probe, output, baseline.output);
  const drifted = score < probe.threshold;

  return {
    status: drifted ? "DRIFT" : "PASS",
    score,
    confidence: drifted ? 0.95 : 0.99,
    explanation: drifted
      ? `Probe output changed below threshold ${probe.threshold.toFixed(2)}.`
      : "Probe output is stable against the latest baseline.",
  };
}

function scoreOutputSimilarity(
  probe: CanonicalProbe,
  output: string,
  baselineOutput: string,
): number {
  if (normalize(output) === normalize(baselineOutput)) {
    return 1;
  }

  if (probe.comparisonType === "exact") {
    return 0;
  }

  const outputTokens = tokenSet(output);
  const baselineTokens = tokenSet(baselineOutput);
  if (outputTokens.size === 0 && baselineTokens.size === 0) {
    return 1;
  }

  const intersection = [...outputTokens].filter((token) => baselineTokens.has(token)).length;
  const union = new Set([...outputTokens, ...baselineTokens]).size;
  if (union === 0) {
    return 0;
  }

  return roundScore(intersection / union);
}

export function hashProbeOutput(output: string): string {
  return `sha256:${createHash("sha256").update(output).digest("hex")}`;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function tokenSet(value: string): ReadonlySet<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_:-]+/u)
      .filter((token) => token.length > 0),
  );
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}
