import { performance } from "node:perf_hooks";

import { createMockProvider } from "../providers/mock-provider.js";
import type { EvalProvider } from "../providers/types.js";
import { loadEvalBaselinesForSnapshot, loadLatestEvalBaselines } from "./baselines.js";
import { evaluateAssertion } from "./evaluators/index.js";
import { loadEvalSuite } from "./loader.js";
import { describeAssertionExpected, summarizeResults } from "./results.js";
import type {
  Assertion,
  AssertionBaseline,
  AssertionEvalResult,
  AssertionStatus,
  PlanRunResult,
} from "./types.js";

export interface RunEvalPlanOptions {
  readonly projectRoot: string;
  readonly suitePath: string;
  readonly dryRun?: boolean | undefined;
  readonly concurrency?: number | undefined;
  readonly allowRegressionIds?: ReadonlySet<string> | undefined;
  readonly assertionIds?: ReadonlySet<string> | undefined;
  readonly tags?: ReadonlySet<string> | undefined;
  readonly provider?: EvalProvider | undefined;
  readonly baselineSnapshotId?: string | undefined;
}

export async function runEvalPlan(options: RunEvalPlanOptions): Promise<PlanRunResult> {
  const startedAt = new Date();
  const startMs = performance.now();
  const provider = options.provider ?? createMockProvider();
  const suite = await loadEvalSuite({ suitePath: options.suitePath });
  const assertions = filterAssertions(suite.assertions, options);
  const loadedBaselines =
    options.baselineSnapshotId !== undefined
      ? await loadEvalBaselinesForSnapshot(options.projectRoot, options.baselineSnapshotId)
      : await loadLatestEvalBaselines(options.projectRoot);
  const dryRun = options.dryRun === true;

  const results = await mapWithConcurrency(
    assertions,
    Math.max(1, options.concurrency ?? 4),
    async (assertion) =>
      dryRun
        ? dryRunResult(assertion, provider.id)
        : evaluate(assertion, provider, loadedBaselines.baselines[assertion.id], options),
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

    if (options.tags !== undefined && options.tags.size > 0) {
      const tags = assertion.tags ?? [];
      return tags.some((tag) => options.tags?.has(tag) ?? false);
    }

    return true;
  });
}

async function evaluate(
  assertion: Assertion,
  provider: EvalProvider,
  baseline: AssertionBaseline | undefined,
  options: RunEvalPlanOptions,
): Promise<AssertionEvalResult> {
  const output = await provider.generate({ input: assertion.input, assertionId: assertion.id });
  const evaluation = await evaluateAssertion(assertion, output);
  const classification = classifyAssertion(assertion, evaluation.score, baseline, options);

  return {
    assertionId: assertion.id,
    type: assertion.type,
    status: classification.status,
    score: evaluation.score,
    baselineScore: baseline?.score,
    delta: baseline === undefined ? undefined : roundScore(evaluation.score - baseline.score),
    providerId: provider.id,
    latencyMs: output.latencyMs,
    tags: assertion.tags ?? [],
    critical: assertion.critical === true,
    explanation: evaluation.explanation,
    expected: evaluation.expected,
    actual: evaluation.actual,
    allowedRegression: classification.allowedRegression,
  };
}

function dryRunResult(assertion: Assertion, providerId: string): AssertionEvalResult {
  return {
    assertionId: assertion.id,
    type: assertion.type,
    status: "NEW",
    score: 0,
    providerId,
    latencyMs: 0,
    tags: assertion.tags ?? [],
    critical: assertion.critical === true,
    explanation: "Dry run only; provider was not invoked.",
    expected: describeAssertionExpected(assertion),
    actual: "",
  };
}

function classifyAssertion(
  assertion: Assertion,
  score: number,
  baseline: AssertionBaseline | undefined,
  options: RunEvalPlanOptions,
): { readonly status: AssertionStatus; readonly allowedRegression?: boolean | undefined } {
  if (baseline === undefined) {
    return { status: "NEW" };
  }

  if (score >= baseline.score) {
    return { status: "PASS" };
  }

  if (options.allowRegressionIds?.has(assertion.id) === true) {
    return { status: "WARN", allowedRegression: true };
  }

  if (assertion.critical === true) {
    return { status: "FAIL" };
  }

  return { status: "WARN" };
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
      if (item === undefined) {
        return;
      }
      results[currentIndex] = await worker(item);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => runWorker()));
  return results;
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}
