import { createHash } from "node:crypto";

import { analyzeScoreRegression, type RegressionStatistics } from "../eval/statistics.js";
import type {
  CanonicalProbe,
  ProbeBaseline,
  ProbeBaselineSample,
  ProbeComparisonType,
  ProbeRubric,
  ProbeSample,
  ProbeStatus,
  ProbeStructuralRule,
} from "./types.js";

export interface ProbeComparison {
  readonly status: ProbeStatus;
  readonly score: number;
  readonly confidence: number;
  readonly explanation: string;
  readonly statistics?: RegressionStatistics | undefined;
}

export interface CompareProbeSamplesOptions {
  readonly significanceLevel?: number | undefined;
  readonly minimumSamples?: number | undefined;
}

/** Compare complete current and baseline distributions with a category-specific strategy. */
export function compareProbeSamples(
  probe: CanonicalProbe,
  currentSamples: readonly ProbeSample[],
  baseline: ProbeBaseline | undefined,
  options: CompareProbeSamplesOptions = {},
): ProbeComparison {
  if (currentSamples.length === 0) {
    return {
      status: "ERROR",
      score: 0,
      confidence: 0,
      explanation: "The provider returned no probe samples.",
    };
  }

  if (baseline === undefined) {
    return {
      status: "NEW",
      score: scoreNewSamples(probe, currentSamples),
      confidence: 0,
      explanation: "No baseline exists in the selected snapshot.",
    };
  }

  const baselineSamples = baseline.samples;
  const minimumSamples = Math.max(2, options.minimumSamples ?? 2);
  if (currentSamples.length < minimumSamples || baselineSamples.length < minimumSamples) {
    return {
      status: "INSUFFICIENT",
      score: scoreAgainstBaseline(probe, currentSamples, baselineSamples),
      confidence: 0,
      explanation: `At least ${minimumSamples} current and baseline samples are required; found ${currentSamples.length} current and ${baselineSamples.length} baseline.`,
    };
  }

  const significanceLevel = options.significanceLevel ?? 0.05;
  const distributions = comparisonDistributions(probe, currentSamples, baselineSamples);
  const statistics = analyzeScoreRegression(
    distributions.current,
    distributions.baseline,
    significanceLevel,
  );
  const score = comparisonScore(probe.comparisonType, statistics);
  const regressed = statistics.delta < 0 && score < probe.threshold;
  const status: ProbeStatus = regressed ? (statistics.significant ? "DRIFT" : "WARN") : "PASS";
  // This public field is the computed confidence that a regression exists,
  // not a probability that the selected status is correct.
  const confidence = roundScore(1 - statistics.pValue);

  return {
    status,
    score,
    confidence,
    explanation: explainComparison(probe, status, statistics, score),
    statistics,
  };
}

/** Legacy one-sample API retained for SDK compatibility. */
export function compareProbeOutput(
  probe: CanonicalProbe,
  output: string,
  baseline: ProbeBaseline | undefined,
): ProbeComparison {
  return compareProbeSamples(probe, [{ output, latencyMs: 0, cached: false }], baseline);
}

export function hashProbeOutput(output: string): string {
  return `sha256:${createHash("sha256").update(output).digest("hex")}`;
}

function comparisonDistributions(
  probe: CanonicalProbe,
  currentSamples: readonly ProbeSample[],
  baselineSamples: readonly ProbeBaselineSample[],
): { readonly current: readonly number[]; readonly baseline: readonly number[] } {
  if (probe.comparisonType === "performance") {
    const baselineLatency = baselineSamples.map((sample) => sample.latencyMs);
    if (baselineLatency.some((latency) => latency === undefined)) {
      throw new RangeError("Performance baseline samples require latency evidence.");
    }
    return {
      current: currentSamples.map((sample) => -sample.latencyMs),
      baseline: baselineLatency.map((latency) => -(latency as number)),
    };
  }

  if (probe.comparisonType === "exact") {
    const reference = modalOutput(baselineSamples.map((sample) => sample.output));
    return {
      current: currentSamples.map((sample) => exactScore(sample.output, reference)),
      baseline: baselineSamples.map((sample) => exactScore(sample.output, reference)),
    };
  }

  return {
    current: currentSamples.map((sample) => scoreSample(probe, sample.output)),
    baseline: baselineSamples.map((sample) => scoreSample(probe, sample.output)),
  };
}

function comparisonScore(
  comparisonType: ProbeComparisonType,
  statistics: RegressionStatistics,
): number {
  if (comparisonType !== "performance") {
    return roundScore(statistics.current.mean);
  }
  const currentMeanLatency = -statistics.current.mean;
  const baselineMeanLatency = -statistics.baseline.mean;
  if (currentMeanLatency <= 0 || baselineMeanLatency <= 0) {
    return currentMeanLatency <= baselineMeanLatency ? 1 : 0;
  }
  return roundScore(Math.min(1, baselineMeanLatency / currentMeanLatency));
}

function scoreAgainstBaseline(
  probe: CanonicalProbe,
  currentSamples: readonly ProbeSample[],
  baselineSamples: readonly ProbeBaselineSample[],
): number {
  const distributions = comparisonDistributions(probe, currentSamples, baselineSamples);
  if (probe.comparisonType === "performance") {
    const currentMean = mean(distributions.current.map((latency) => -latency));
    const baselineMean = mean(distributions.baseline.map((latency) => -latency));
    return currentMean <= 0 || baselineMean <= 0
      ? 0
      : roundScore(Math.min(1, baselineMean / currentMean));
  }
  return roundScore(mean(distributions.current));
}

function scoreNewSamples(probe: CanonicalProbe, samples: readonly ProbeSample[]): number {
  if (probe.comparisonType === "performance") return 1;
  if (probe.comparisonType === "exact") {
    const reference = modalOutput(samples.map((sample) => sample.output));
    return roundScore(mean(samples.map((sample) => exactScore(sample.output, reference))));
  }
  return roundScore(mean(samples.map((sample) => scoreSample(probe, sample.output))));
}

function scoreSample(probe: CanonicalProbe, output: string): number {
  switch (probe.comparisonType) {
    case "structural":
      return scoreStructural(probe.structuralRule, output);
    case "semantic":
    case "behavioral":
      return scoreRubric(probe.rubric, output);
    case "exact":
    case "performance":
      throw new RangeError(`Comparison type ${probe.comparisonType} needs distribution context.`);
  }
}

function scoreStructural(rule: ProbeStructuralRule | undefined, output: string): number {
  if (rule === undefined) {
    throw new RangeError("Structural probes require an explicit structural rule.");
  }
  const trimmed = output.trim();
  try {
    switch (rule) {
      case "json_object_name_status": {
        const value: unknown = JSON.parse(trimmed);
        if (typeof value !== "object" || value === null || Array.isArray(value)) return 0;
        const keys = Object.keys(value as Record<string, unknown>).sort();
        return keys.length === 2 && keys[0] === "name" && keys[1] === "status" ? 1 : 0;
      }
      case "json_array_red_green_blue": {
        const value: unknown = JSON.parse(trimmed);
        return Array.isArray(value) &&
          value.length === 3 &&
          value[0] === "red" &&
          value[1] === "green" &&
          value[2] === "blue"
          ? 1
          : 0;
      }
      case "numbered_list_three": {
        const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
        return lines.length === 3 &&
          lines.every((line, index) => new RegExp(`^\\s*${index + 1}[.)]\\s+\\S`, "u").test(line))
          ? 1
          : 0;
      }
      case "xml_result_ok":
        return /^<result>\s*ok\s*<\/result>$/iu.test(trimmed) ? 1 : 0;
    }
  } catch {
    return 0;
  }
}

function scoreRubric(rubric: ProbeRubric | undefined, output: string): number {
  if (rubric === undefined || rubric.required.length === 0) {
    throw new RangeError("Semantic and behavioral probes require an explicit rubric.");
  }
  if (rubric.forbidden?.some((pattern) => new RegExp(pattern, "iu").test(output)) === true) {
    return 0;
  }
  const satisfied = rubric.required.filter((concept) =>
    concept.anyOf.some((pattern) => new RegExp(pattern, "iu").test(output)),
  ).length;
  return roundScore(satisfied / rubric.required.length);
}

function modalOutput(outputs: readonly string[]): string {
  const counts = new Map<string, { readonly original: string; count: number }>();
  for (const output of outputs) {
    const key = normalize(output);
    const entry = counts.get(key);
    if (entry === undefined) counts.set(key, { original: output, count: 1 });
    else entry.count += 1;
  }
  return [...counts.entries()].sort(
    ([leftKey, left], [rightKey, right]) =>
      right.count - left.count || leftKey.localeCompare(rightKey),
  )[0]![1].original;
}

function exactScore(output: string, reference: string): number {
  return normalize(output) === normalize(reference) ? 1 : 0;
}

function explainComparison(
  probe: CanonicalProbe,
  status: ProbeStatus,
  statistics: RegressionStatistics,
  score: number,
): string {
  const evidence = `${statistics.current.sampleCount} current vs ${statistics.baseline.sampleCount} baseline samples; ${statistics.method} p=${statistics.pValue.toFixed(6)}`;
  if (status === "DRIFT") {
    return `Statistically significant ${probe.comparisonType} regression below threshold ${probe.threshold.toFixed(2)} (score ${score.toFixed(2)}; ${evidence}).`;
  }
  if (status === "WARN") {
    return `Observed ${probe.comparisonType} degradation is below threshold but not statistically significant (score ${score.toFixed(2)}; ${evidence}).`;
  }
  return `Probe is stable for the ${probe.comparisonType} comparator (score ${score.toFixed(2)}; ${evidence}).`;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
