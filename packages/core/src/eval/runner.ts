import { performance } from "node:perf_hooks";

import { AIDriftError, ExitCode } from "../errors.js";
import { createMockProvider } from "../providers/mock-provider.js";
import { ProviderOutputBudget } from "../providers/output-validation.js";
import { containsSecretLikeValue } from "../manifest/security.js";
import type { EvalProvider, ProviderGenerateRequest, ProviderOutput } from "../providers/types.js";
import { loadEvalBaselinesForSnapshot, loadLatestEvalBaselines } from "./baselines.js";
import { evaluateAssertion } from "./evaluators/index.js";
import { loadEvalSuite } from "./loader.js";
import {
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_EXECUTIONS,
  MAX_EVAL_SAMPLES,
  MAX_EVAL_TIMEOUT_MS,
} from "./limits.js";
import { describeAssertionExpected, summarizeResults } from "./results.js";
import { analyzeScoreRegression, distribution } from "./statistics.js";
import type {
  Assertion,
  AssertionBaseline,
  AssertionEvalResult,
  AssertionSampleResult,
  AssertionStatisticalEvidence,
  AssertionStatus,
  EvalSuite,
  EvalExecutionTarget,
  PlanRunResult,
} from "./types.js";

const DEFAULT_SAMPLES = 5;
const DEFAULT_SIGNIFICANCE_LEVEL = 0.05;
const DEFAULT_TIMEOUT_MS = 30_000;
const DOCS_URL = "https://github.com/Parth2412/aidrift#readme";

export interface RunEvalPlanOptions {
  readonly projectRoot: string;
  readonly suitePath: string;
  readonly dryRun?: boolean | undefined;
  readonly concurrency?: number | undefined;
  readonly samples?: number | undefined;
  readonly significanceLevel?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly budgetUsd?: number | undefined;
  readonly allowRegressionIds?: ReadonlySet<string> | undefined;
  readonly assertionIds?: ReadonlySet<string> | undefined;
  readonly tags?: ReadonlySet<string> | undefined;
  readonly provider?: EvalProvider | undefined;
  readonly baselineSnapshotId?: string | undefined;
  readonly storagePath?: string | undefined;
  readonly executionTarget?: EvalExecutionTarget | undefined;
}

export async function runEvalPlan(options: RunEvalPlanOptions): Promise<PlanRunResult> {
  const startedAt = new Date();
  const startMs = performance.now();
  const provider = options.provider ?? createMockProvider();
  validateProviderIdentity(provider);
  const suite = await loadEvalSuite({
    suitePath: options.suitePath,
    projectRoot: options.projectRoot,
  });
  validateSelection(suite, options);
  const assertions = filterAssertions(suite.assertions, options);
  const loadedBaselines =
    options.baselineSnapshotId !== undefined
      ? await loadEvalBaselinesForSnapshot(
          options.projectRoot,
          options.baselineSnapshotId,
          options.storagePath,
        )
      : await loadLatestEvalBaselines(options.projectRoot, options.storagePath);
  const dryRun = options.dryRun === true;
  const samples = boundedPositiveInteger(
    options.samples ?? DEFAULT_SAMPLES,
    "samples",
    MAX_EVAL_SAMPLES,
  );
  const significanceLevel = validSignificanceLevel(
    options.significanceLevel ?? DEFAULT_SIGNIFICANCE_LEVEL,
  );
  const timeoutMs = boundedPositiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs",
    MAX_EVAL_TIMEOUT_MS,
  );
  if (assertions.length * samples > MAX_EVAL_EXECUTIONS) {
    throw evalConfigError(
      `The selected workload exceeds the ${MAX_EVAL_EXECUTIONS}-execution limit.`,
    );
  }
  const concurrency = boundedPositiveInteger(
    options.concurrency ?? 4,
    "concurrency",
    MAX_EVAL_CONCURRENCY,
  );
  const deadlineMs = startMs + timeoutMs;
  const budget = new EvalBudget(options.budgetUsd);
  const outputBudget = new ProviderOutputBudget("eval");

  const results = await mapWithConcurrency(
    assertions,
    options.budgetUsd === undefined ? concurrency : 1,
    async (assertion) =>
      dryRun
        ? dryRunResult(assertion, provider.id, samples, significanceLevel)
        : evaluateSamples({
            assertion,
            provider,
            baseline: loadedBaselines.baselines[assertion.id],
            options,
            samples,
            significanceLevel,
            deadlineMs,
            budget,
            outputBudget,
          }),
  );

  const sortedResults = [...results].sort((left, right) =>
    left.assertionId.localeCompare(right.assertionId),
  );
  const summary = summarizeResults(sortedResults);
  const completedAt = new Date();

  return {
    suitePath: options.suitePath,
    providerId: provider.id,
    baselineSnapshotId: loadedBaselines.snapshotId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.round(performance.now() - startMs),
    dryRun,
    requestedSamples: samples,
    significanceLevel,
    totalCostUsd: budget.totalCostUsd,
    unknownCostSamples: budget.unknownCostSamples,
    executionTarget: options.executionTarget,
    results: sortedResults,
    summary,
    hasRegressions: summary.regressions > 0,
  };
}

function filterAssertions(
  assertions: readonly Assertion[],
  options: RunEvalPlanOptions,
): readonly Assertion[] {
  return assertions.filter((assertion) => {
    if (options.assertionIds !== undefined && !options.assertionIds.has(assertion.id)) {
      return false;
    }
    if (options.tags !== undefined) {
      const tags = assertion.tags ?? [];
      return tags.some((tag) => options.tags?.has(tag) ?? false);
    }
    return true;
  });
}

function validateSelection(suite: EvalSuite, options: RunEvalPlanOptions): void {
  if (
    (options.assertionIds?.size ?? 0) > 10_000 ||
    (options.allowRegressionIds?.size ?? 0) > 10_000
  ) {
    throw evalConfigError("At most 10000 assertion ids can be selected per run.");
  }
  if ((options.tags?.size ?? 0) > 1_000) {
    throw evalConfigError("At most 1000 eval tags can be selected per run.");
  }
  const assertionIds = new Set(suite.assertions.map((assertion) => assertion.id));
  const unknownAssertionIds = [...(options.assertionIds ?? [])].filter(
    (id) => !assertionIds.has(id),
  );
  const unknownAllowedIds = [...(options.allowRegressionIds ?? [])].filter(
    (id) => !assertionIds.has(id),
  );
  if (unknownAssertionIds.length > 0 || unknownAllowedIds.length > 0) {
    throw evalConfigError(
      `Unknown assertion id(s): ${[...unknownAssertionIds, ...unknownAllowedIds].join(", ")}.`,
    );
  }
  if (options.assertionIds !== undefined && options.assertionIds.size === 0) {
    throw evalConfigError("The selected assertion id list is empty.");
  }
  if (options.tags !== undefined && filterAssertions(suite.assertions, options).length === 0) {
    throw evalConfigError("The selected eval tags did not match any assertions.");
  }
}

function validateProviderIdentity(provider: EvalProvider): void {
  if (
    typeof provider.id !== "string" ||
    provider.id.trim().length === 0 ||
    provider.id.length > 256 ||
    /[\0\r\n]/u.test(provider.id)
  ) {
    throw evalConfigError("The provider executor must expose a non-empty single-line id.");
  }
}

async function evaluateSamples(input: {
  readonly assertion: Assertion;
  readonly provider: EvalProvider;
  readonly baseline: AssertionBaseline | undefined;
  readonly options: RunEvalPlanOptions;
  readonly samples: number;
  readonly significanceLevel: number;
  readonly deadlineMs: number;
  readonly budget: EvalBudget;
  readonly outputBudget: ProviderOutputBudget;
}): Promise<AssertionEvalResult> {
  const sampleResults: AssertionSampleResult[] = [];
  for (let sampleIndex = 0; sampleIndex < input.samples; sampleIndex += 1) {
    input.outputBudget.assertCanContinue();
    const output = input.outputBudget.validateAndRecord(
      await generateBeforeDeadline(
        input.provider,
        { input: input.assertion.input, assertionId: input.assertion.id },
        input.deadlineMs,
      ),
      `assertion ${input.assertion.id}`,
    );
    input.budget.record(output.costUsd, input.assertion.id);
    if (containsSecretLikeValue(output.content)) {
      throw new AIDriftError({
        code: "eval.output.secret_detected",
        exitCode: ExitCode.ConfigError,
        what: `Secret-like provider output detected for assertion ${input.assertion.id}.`,
        why: "Eval output can be returned to callers or persisted as plan and baseline evidence.",
        fix: "Correct the target so it does not return credentials or other secret-bearing content.",
        docs: DOCS_URL,
      });
    }
    const evaluation = await evaluateAssertion(input.assertion, output);
    sampleResults.push({
      sampleIndex,
      score: evaluation.score,
      output: output.content,
      latencyMs: output.latencyMs,
      ...(output.costUsd !== undefined ? { costUsd: output.costUsd } : {}),
      explanation: evaluation.explanation,
      expected: evaluation.expected,
      actual: evaluation.actual,
    });
  }

  const scores = sampleResults.map((sample) => sample.score);
  const currentDistribution = distribution(scores);
  const statistics =
    input.baseline === undefined
      ? undefined
      : toAssertionStatistics(
          analyzeScoreRegression(scores, input.baseline.scores, input.significanceLevel),
        );
  const classification = classifyAssertion(
    input.assertion,
    currentDistribution.mean,
    statistics,
    input,
  );
  const first = sampleResults[0]!;
  const latencyMs = sampleResults.reduce((total, sample) => total + sample.latencyMs, 0);
  const costUsd = sampleResults.reduce((total, sample) => total + (sample.costUsd ?? 0), 0);

  return {
    assertionId: input.assertion.id,
    type: input.assertion.type,
    status: classification.status,
    score: currentDistribution.mean,
    baselineScore: input.baseline?.score,
    delta:
      input.baseline === undefined
        ? undefined
        : roundScore(currentDistribution.mean - input.baseline.score),
    providerId: input.provider.id,
    latencyMs: roundScore(latencyMs / sampleResults.length),
    costUsd,
    output: first.output,
    samples: sampleResults,
    statistics,
    tags: input.assertion.tags ?? [],
    critical: input.assertion.critical === true,
    explanation: first.explanation,
    expected: first.expected,
    actual: first.actual,
    allowedRegression: classification.allowedRegression,
  };
}

function dryRunResult(
  assertion: Assertion,
  providerId: string,
  requestedSamples: number,
  significanceLevel: number,
): AssertionEvalResult {
  return {
    assertionId: assertion.id,
    type: assertion.type,
    status: "NEW",
    score: 0,
    providerId,
    latencyMs: 0,
    costUsd: 0,
    output: "",
    samples: [],
    tags: assertion.tags ?? [],
    critical: assertion.critical === true,
    explanation: `Dry run only; provider would run ${requestedSamples} sample(s) at significance ${significanceLevel}.`,
    expected: describeAssertionExpected(assertion),
    actual: "",
  };
}

function classifyAssertion(
  assertion: Assertion,
  score: number,
  statistics: AssertionStatisticalEvidence | undefined,
  input: { readonly baseline: AssertionBaseline | undefined; readonly options: RunEvalPlanOptions },
): { readonly status: AssertionStatus; readonly allowedRegression?: boolean | undefined } {
  if (input.baseline === undefined) return { status: "NEW" };
  if (score >= input.baseline.score) return { status: "PASS" };
  if (input.options.allowRegressionIds?.has(assertion.id) === true) {
    return { status: "WARN", allowedRegression: true };
  }
  if (assertion.critical === true && statistics?.significant === true) {
    return { status: "FAIL" };
  }
  return { status: "WARN" };
}

function toAssertionStatistics(
  statistics: ReturnType<typeof analyzeScoreRegression>,
): AssertionStatisticalEvidence {
  return {
    method: statistics.method,
    sampleCount: statistics.current.sampleCount,
    baselineSampleCount: statistics.baseline.sampleCount,
    standardDeviation: statistics.current.standardDeviation,
    baselineStandardDeviation: statistics.baseline.standardDeviation,
    pValue: statistics.pValue,
    significanceLevel: statistics.significanceLevel,
    confidenceLevel: statistics.confidenceLevel,
    confidenceInterval: statistics.confidenceInterval,
    significant: statistics.significant,
  };
}

async function generateBeforeDeadline(
  provider: EvalProvider,
  request: ProviderGenerateRequest,
  deadlineMs: number,
): Promise<ProviderOutput> {
  const remainingMs = deadlineMs - performance.now();
  if (remainingMs <= 0) throw evalTimeoutError();
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(evalTimeoutError());
    }, remainingMs);
  });
  try {
    return await Promise.race([
      provider.generate({ ...request, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

class EvalBudget {
  totalCostUsd = 0;
  unknownCostSamples = 0;

  constructor(private readonly budgetUsd: number | undefined) {
    if (budgetUsd !== undefined && (!Number.isFinite(budgetUsd) || budgetUsd < 0)) {
      throw evalConfigError("Eval budget must be a finite non-negative USD amount.");
    }
  }

  record(costUsd: number | undefined, assertionId: string): void {
    if (costUsd === undefined) {
      this.unknownCostSamples += 1;
      if (this.budgetUsd !== undefined) {
        throw new AIDriftError({
          code: "eval.cost.unknown",
          exitCode: ExitCode.ConfigError,
          what: `Cannot enforce the eval budget for assertion ${assertionId}.`,
          why: "The selected provider/model has no verified runtime cost mapping.",
          fix: "Use a model with known pricing, remove the budget, or update the verified cost table.",
          docs: DOCS_URL,
        });
      }
      return;
    }
    const next = this.totalCostUsd + costUsd;
    if (this.budgetUsd !== undefined && next > this.budgetUsd) {
      throw new AIDriftError({
        code: "eval.budget.exceeded",
        exitCode: ExitCode.ConfigError,
        what: `Eval cost $${next.toFixed(6)} exceeded budget $${this.budgetUsd.toFixed(6)}.`,
        why: "Observed provider usage crossed the configured eval budget.",
        fix: "Increase --budget, reduce samples/assertions, or use a lower-cost model.",
        docs: DOCS_URL,
      });
    }
    this.totalCostUsd = next;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) return;
      results[currentIndex] = await worker(item);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => runWorker()));
  return results;
}

function boundedPositiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw evalConfigError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function validSignificanceLevel(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw evalConfigError("significanceLevel must be greater than 0 and less than 1.");
  }
  return value;
}

function evalTimeoutError(): AIDriftError {
  return new AIDriftError({
    code: "eval.timeout",
    exitCode: ExitCode.ConfigError,
    what: "The eval run exceeded its configured timeout.",
    why: "The provider did not complete all requested samples before the run deadline.",
    fix: "Increase --timeout or eval.timeout_seconds, or reduce assertions and samples.",
    docs: DOCS_URL,
  });
}

function evalConfigError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "eval.config.invalid",
    exitCode: ExitCode.ConfigError,
    what: "The eval run configuration is invalid.",
    why: reason,
    fix: "Correct the eval manifest or CLI selection and run again.",
    docs: DOCS_URL,
  });
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
