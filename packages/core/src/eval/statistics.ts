export type StatisticalMethod = "fisher_exact" | "welch_t";

export interface ScoreDistribution {
  readonly sampleCount: number;
  readonly mean: number;
  readonly standardDeviation: number;
}

export interface RegressionStatistics {
  readonly method: StatisticalMethod;
  readonly current: ScoreDistribution;
  readonly baseline: ScoreDistribution;
  readonly delta: number;
  readonly pValue: number;
  readonly significanceLevel: number;
  readonly confidenceLevel: number;
  readonly confidenceInterval: readonly [number, number];
  readonly significant: boolean;
}

export function analyzeScoreRegression(
  currentScores: readonly number[],
  baselineScores: readonly number[],
  significanceLevel: number,
): RegressionStatistics {
  assertScores(currentScores, "current");
  assertScores(baselineScores, "baseline");
  if (!(significanceLevel > 0 && significanceLevel < 1)) {
    throw new RangeError("significanceLevel must be between 0 and 1.");
  }

  const current = distribution(currentScores);
  const baseline = distribution(baselineScores);
  const delta = round(current.mean - baseline.mean);
  const binary = [...currentScores, ...baselineScores].every((score) => score === 0 || score === 1);
  const method: StatisticalMethod = binary ? "fisher_exact" : "welch_t";
  const pValue = binary
    ? fisherRegressionPValue(currentScores, baselineScores)
    : welchRegressionPValue(currentScores, baselineScores);
  const confidenceLevel = 1 - significanceLevel;

  return {
    method,
    current,
    baseline,
    delta,
    pValue: round(pValue),
    significanceLevel,
    confidenceLevel,
    confidenceInterval: meanDifferenceInterval(
      current,
      baseline,
      inverseStandardNormal(1 - significanceLevel / 2),
    ),
    significant: delta < 0 && pValue <= significanceLevel,
  };
}

export function distribution(scores: readonly number[]): ScoreDistribution {
  if (scores.length === 0) {
    throw new RangeError("A score distribution requires at least one sample.");
  }
  const mean = scores.reduce((total, score) => total + score, 0) / scores.length;
  const variance =
    scores.length < 2
      ? 0
      : scores.reduce((total, score) => total + (score - mean) ** 2, 0) / (scores.length - 1);
  return {
    sampleCount: scores.length,
    mean: round(mean),
    standardDeviation: round(Math.sqrt(variance)),
  };
}

function fisherRegressionPValue(
  currentScores: readonly number[],
  baselineScores: readonly number[],
): number {
  const currentSuccesses = currentScores.filter((score) => score === 1).length;
  const baselineSuccesses = baselineScores.filter((score) => score === 1).length;
  const totalSuccesses = currentSuccesses + baselineSuccesses;
  const total = currentScores.length + baselineScores.length;
  const minimum = Math.max(0, currentScores.length - (total - totalSuccesses));
  const maximum = Math.min(currentScores.length, totalSuccesses, currentSuccesses);
  let probability = 0;
  for (let successes = minimum; successes <= maximum; successes += 1) {
    probability += Math.exp(
      logCombination(totalSuccesses, successes) +
        logCombination(total - totalSuccesses, currentScores.length - successes) -
        logCombination(total, currentScores.length),
    );
  }
  return clampProbability(probability);
}

function welchRegressionPValue(
  currentScores: readonly number[],
  baselineScores: readonly number[],
): number {
  const current = distribution(currentScores);
  const baseline = distribution(baselineScores);
  const currentVarianceTerm = current.standardDeviation ** 2 / current.sampleCount;
  const baselineVarianceTerm = baseline.standardDeviation ** 2 / baseline.sampleCount;
  const standardErrorSquared = currentVarianceTerm + baselineVarianceTerm;
  if (standardErrorSquared === 0) {
    return current.mean < baseline.mean ? 0 : 1;
  }

  const t = (current.mean - baseline.mean) / Math.sqrt(standardErrorSquared);
  const denominator =
    (current.sampleCount > 1 ? currentVarianceTerm ** 2 / (current.sampleCount - 1) : 0) +
    (baseline.sampleCount > 1 ? baselineVarianceTerm ** 2 / (baseline.sampleCount - 1) : 0);
  if (denominator === 0) {
    return t < 0 ? 0 : 1;
  }
  const degreesOfFreedom = standardErrorSquared ** 2 / denominator;
  return studentTCdf(t, degreesOfFreedom);
}

function studentTCdf(t: number, degreesOfFreedom: number): number {
  const x = degreesOfFreedom / (degreesOfFreedom + t * t);
  const halfBeta = 0.5 * regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5);
  return clampProbability(t >= 0 ? 1 - halfBeta : halfBeta);
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (factor * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (factor * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-12;
  const floor = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  d = Math.abs(d) < floor ? floor : d;
  d = 1 / d;
  let result = d;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const twice = 2 * iteration;
    let coefficient = (iteration * (b - iteration) * x) / ((qam + twice) * (a + twice));
    d = 1 + coefficient * d;
    d = Math.abs(d) < floor ? floor : d;
    c = 1 + coefficient / c;
    c = Math.abs(c) < floor ? floor : c;
    d = 1 / d;
    result *= d * c;

    coefficient = (-(a + iteration) * (qab + iteration) * x) / ((a + twice) * (qap + twice));
    d = 1 + coefficient * d;
    d = Math.abs(d) < floor ? floor : d;
    c = 1 + coefficient / c;
    c = Math.abs(c) < floor ? floor : c;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return result;
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let sum = 0.9999999999998099;
  coefficients.forEach((coefficient, index) => {
    sum += coefficient / (shifted + index + 1);
  });
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

function logCombination(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

function meanDifferenceInterval(
  current: ScoreDistribution,
  baseline: ScoreDistribution,
  criticalValue: number,
): readonly [number, number] {
  const delta = current.mean - baseline.mean;
  const standardError = Math.sqrt(
    current.standardDeviation ** 2 / current.sampleCount +
      baseline.standardDeviation ** 2 / baseline.sampleCount,
  );
  return [
    round(delta - criticalValue * standardError),
    round(delta + criticalValue * standardError),
  ];
}

// Peter J. Acklam's rational approximation for the inverse standard-normal CDF.
function inverseStandardNormal(probability: number): number {
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472,
    2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857,
  ];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373,
    4.37466414146497, 2.93816398269878,
  ];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (probability <= high) {
    const q = probability - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - probability));
  return (
    -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

function assertScores(scores: readonly number[], label: string): void {
  if (scores.length === 0 || scores.some((score) => !Number.isFinite(score))) {
    throw new RangeError(`${label} scores must contain finite samples.`);
  }
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
