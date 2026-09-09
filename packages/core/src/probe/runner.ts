import { performance } from "node:perf_hooks";

import { AIDriftError, ExitCode } from "../errors.js";
import { containsSecretLikeValue } from "../manifest/security.js";
import { structuredValueLimitViolation } from "../files/structured-value.js";
import {
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_SAMPLES,
  MAX_EVAL_TIMEOUT_MS,
  MAX_PROBE_CACHE_TTL_MINUTES,
  MAX_PROBE_EXECUTIONS,
  MAX_PROBE_MODELS,
} from "../eval/limits.js";
import { createMockProvider } from "../providers/mock-provider.js";
import { ProviderOutputBudget } from "../providers/output-validation.js";
import type { EvalProvider } from "../providers/types.js";
import {
  loadLatestProbeBaselines,
  loadProbeBaselinesForSnapshot,
  probeBaselineKey,
} from "./baselines.js";
import { readCachedProbeSample, writeCachedProbeSample } from "./cache.js";
import { BUILT_IN_PROBES } from "./canonical.js";
import { compareProbeSamples } from "./comparator.js";
import type {
  CanonicalProbe,
  ProbeBaseline,
  ProbeResult,
  ProbeRunResult,
  ProbeRunSummary,
  ProbeSample,
  RunProviderProbesOptions,
} from "./types.js";

export async function runProviderProbes(
  options: RunProviderProbesOptions,
): Promise<ProbeRunResult> {
  const startedAt = new Date();
  const startMs = performance.now();
  validateRunOptions(options);
  const defaultProvider = options.provider;
  const providersByModel = new Map(
    options.models.map((model) => [model.name, resolveProvider(model, options, defaultProvider)]),
  );
  const samples = options.samples ?? 5;
  const deadlineMs = startMs + (options.timeoutMs ?? 30_000);
  const budget = new ProbeBudget(options.budgetUsd);
  const outputBudget = new ProviderOutputBudget("probe");
  const cacheTtlMinutes = options.useCache === false ? 0 : (options.cacheTtlMinutes ?? 60);
  const probes = filterProbes(options);
  const loadedBaselines =
    options.baselineSnapshotId === undefined
      ? await loadLatestProbeBaselines(options.projectRoot, options.storagePath)
      : await loadProbeBaselinesForSnapshot(
          options.projectRoot,
          options.baselineSnapshotId,
          options.storagePath,
        );

  const workItems = options.models.flatMap((model) =>
    probes.map((probe) => ({
      model,
      probe,
    })),
  );

  const results = await mapWithConcurrency(
    workItems,
    options.budgetUsd === undefined ? (options.concurrency ?? 4) : 1,
    async ({ model, probe }) => {
      const provider =
        providersByModel.get(model.name) ?? resolveProvider(model, options, defaultProvider);
      const baseline = loadedBaselines.baselines[probeBaselineKey(model.name, probe.id)];
      const probeSamples: ProbeSample[] = [];

      try {
        const identityIssue = validateEvidenceIdentity(model, probe, provider.id, baseline);
        if (identityIssue !== undefined) {
          throw new Error(identityIssue);
        }
        for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
          outputBudget.assertCanContinue();
          const cached = await readCachedProbeSample({
            projectRoot: options.projectRoot,
            modelName: model.name,
            model: model.model,
            parameters: model.parameters,
            providerId: provider.id,
            probeId: probe.id,
            input: probe.input,
            sampleIndex,
            ttlMinutes: cacheTtlMinutes,
          });

          if (cached !== undefined) {
            outputBudget.validateAndRecord(cached, `${model.name}/${probe.id}`);
            assertProbeOutputSafe(cached.output, `${model.name}/${probe.id}`);
            probeSamples.push(cached);
            continue;
          }

          budget.assertCanContinue();
          const output = outputBudget.validateAndRecord(
            await generateBeforeDeadline(
              provider,
              {
                input: probe.input,
                probeId: probe.id,
                modelName: model.name,
              },
              deadlineMs,
            ),
            `${model.name}/${probe.id}`,
          );
          budget.record(output.costUsd, `${model.name}/${probe.id}`);
          assertProbeOutputSafe(output.content, `${model.name}/${probe.id}`);
          const sample: ProbeSample = {
            output: output.content,
            latencyMs: output.latencyMs,
            ...(output.costUsd !== undefined ? { costUsd: output.costUsd } : {}),
            cached: false,
          };
          probeSamples.push(sample);
          await writeCachedProbeSample(
            {
              projectRoot: options.projectRoot,
              modelName: model.name,
              model: model.model,
              parameters: model.parameters,
              providerId: provider.id,
              probeId: probe.id,
              input: probe.input,
              sampleIndex,
              ttlMinutes: cacheTtlMinutes,
            },
            sample,
          );
        }

        const comparison = compareProbeSamples(probe, probeSamples, baseline, {
          significanceLevel: options.significanceLevel ?? 0.05,
        });
        return {
          modelName: model.name,
          provider: provider.id,
          model: model.model,
          probeId: probe.id,
          category: probe.category,
          status: comparison.status,
          score: comparison.score,
          baselineScore: baseline?.score,
          confidence: comparison.confidence,
          explanation: comparison.explanation,
          statistics: comparison.statistics,
          samples: probeSamples,
        } satisfies ProbeResult;
      } catch (error) {
        return {
          modelName: model.name,
          provider: provider.id,
          model: model.model,
          probeId: probe.id,
          category: probe.category,
          status: "ERROR",
          score: 0,
          baselineScore: baseline?.score,
          confidence: 0,
          explanation: formatProbeExecutionError(error),
          samples: probeSamples,
        } satisfies ProbeResult;
      }
    },
  );

  const sortedResults = [...results].sort((left, right) =>
    `${left.modelName}/${left.probeId}`.localeCompare(`${right.modelName}/${right.probeId}`),
  );
  const summary = summarizeProbeResults(sortedResults);
  const providerIds = new Set([...providersByModel.values()].map((provider) => provider.id));

  return {
    providerId: providerIds.size === 1 ? [...providerIds][0]! : "multiple",
    baselineSnapshotId: loadedBaselines.snapshotId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startMs),
    requestedSamples: samples,
    totalCostUsd: budget.totalCostUsd,
    unknownCostSamples: budget.unknownCostSamples,
    results: sortedResults,
    summary,
    hasDrift: summary.drifted > 0,
  };
}

function assertProbeOutputSafe(output: string, evidenceId: string): void {
  if (!containsSecretLikeValue(output)) return;
  throw new AIDriftError({
    code: "probe.output.secret_detected",
    exitCode: ExitCode.ConfigError,
    what: `Secret-like provider output detected for ${evidenceId}.`,
    why: "Probe outputs can be persisted in the local cache and snapshot baselines.",
    fix: "Remove secret-bearing output or correct the provider target before retrying.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function filterProbes(options: RunProviderProbesOptions): readonly CanonicalProbe[] {
  return BUILT_IN_PROBES.filter((probe) => {
    if (options.probeIds !== undefined && !options.probeIds.has(probe.id)) {
      return false;
    }

    if (options.categories !== undefined && !options.categories.has(probe.category)) {
      return false;
    }

    return true;
  });
}

function summarizeProbeResults(results: readonly ProbeResult[]): ProbeRunSummary {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === "PASS").length,
    warned: results.filter((result) => result.status === "WARN").length,
    drifted: results.filter((result) => result.status === "DRIFT").length,
    insufficient: results.filter((result) => result.status === "INSUFFICIENT").length,
    errors: results.filter((result) => result.status === "ERROR").length,
    new: results.filter((result) => result.status === "NEW").length,
  };
}

function resolveProvider(
  model: RunProviderProbesOptions["models"][number],
  options: RunProviderProbesOptions,
  defaultProvider: EvalProvider | undefined,
): EvalProvider {
  const provider =
    options.providerForModel?.(model) ??
    defaultProvider ??
    (model.provider === "mock" || options.allowProviderOverride === true
      ? createMockProvider({ model: model.model, parameters: model.parameters })
      : undefined);
  if (provider === undefined) {
    throw probeConfigError(
      "probe.provider.executor_missing",
      `No provider executor was supplied for ${model.name} (${model.provider}/${model.model}).`,
    );
  }
  if (
    typeof provider.id !== "string" ||
    provider.id.trim().length === 0 ||
    provider.id.length > 256 ||
    /[\0\r\n]/u.test(provider.id)
  ) {
    throw probeConfigError(
      "probe.provider.executor_invalid",
      `Provider executor identity is invalid for ${model.name}.`,
    );
  }
  if (options.allowProviderOverride !== true && provider.id !== model.provider) {
    throw probeConfigError(
      "probe.provider.identity_mismatch",
      `Provider identity mismatch for ${model.name}: artifact declares ${model.provider}, executor is ${provider.id}.`,
    );
  }
  return provider;
}

function validateRunOptions(options: RunProviderProbesOptions): void {
  if (options.models.length === 0) {
    throw probeConfigError("probe.model.missing", "At least one model target is required.");
  }
  if (options.models.length > MAX_PROBE_MODELS) {
    throw probeConfigError(
      "probe.model.limit_exceeded",
      `A probe run supports at most ${MAX_PROBE_MODELS} model targets.`,
    );
  }
  const names = new Set<string>();
  for (const model of options.models) {
    if (
      model.name.trim().length === 0 ||
      model.provider.trim().length === 0 ||
      model.model.trim().length === 0 ||
      model.name.length > 512 ||
      model.provider.length > 256 ||
      model.model.length > 512 ||
      /[\0\r\n]/u.test(`${model.name}${model.provider}${model.model}`)
    ) {
      throw probeConfigError(
        "probe.model.invalid",
        "Model name, provider, and model id must all be non-empty.",
      );
    }
    const parameterViolation = structuredValueLimitViolation(model.parameters, {
      maximumNodes: 10_000,
      maximumDepth: 64,
      maximumCollectionEntries: 1_000,
    });
    if (parameterViolation !== undefined) {
      throw probeConfigError(
        "probe.model.invalid",
        `Model parameters for ${model.name} are invalid: ${parameterViolation}`,
      );
    }
    if (names.has(model.name)) {
      throw probeConfigError(
        "probe.model.duplicate",
        `Duplicate model target name: ${model.name}.`,
      );
    }
    names.add(model.name);
  }
  assertBoundedPositiveInteger(options.samples ?? 5, "samples", MAX_EVAL_SAMPLES);
  assertBoundedPositiveInteger(options.concurrency ?? 4, "concurrency", MAX_EVAL_CONCURRENCY);
  assertBoundedPositiveInteger(options.timeoutMs ?? 30_000, "timeoutMs", MAX_EVAL_TIMEOUT_MS);
  if (
    options.budgetUsd !== undefined &&
    (!Number.isFinite(options.budgetUsd) || options.budgetUsd < 0)
  ) {
    throw probeConfigError(
      "probe.budget.invalid",
      "budgetUsd must be a finite non-negative USD amount.",
    );
  }
  const ttl = options.cacheTtlMinutes ?? 60;
  if (!Number.isFinite(ttl) || ttl < 0 || ttl > MAX_PROBE_CACHE_TTL_MINUTES) {
    throw probeConfigError(
      "probe.option.invalid",
      `cacheTtlMinutes must be between 0 and ${MAX_PROBE_CACHE_TTL_MINUTES}.`,
    );
  }
  const significanceLevel = options.significanceLevel ?? 0.05;
  if (!(significanceLevel > 0 && significanceLevel < 1)) {
    throw probeConfigError("probe.option.invalid", "significanceLevel must be between 0 and 1.");
  }
  if (options.probeIds !== undefined) {
    if (options.probeIds.size > BUILT_IN_PROBES.length) {
      throw probeConfigError(
        "probe.selection.invalid",
        `At most ${BUILT_IN_PROBES.length} canonical probe ids can be selected.`,
      );
    }
    const known = new Set(BUILT_IN_PROBES.map((probe) => probe.id));
    const unknown = [...options.probeIds].filter((probeId) => !known.has(probeId));
    if (unknown.length > 0) {
      throw probeConfigError(
        "probe.selection.invalid",
        `Unknown canonical probe id${unknown.length === 1 ? "" : "s"}: ${unknown.sort().join(", ")}.`,
      );
    }
  }
  if (options.categories !== undefined) {
    if (options.categories.size > 5) {
      throw probeConfigError(
        "probe.selection.invalid",
        "At most five canonical probe categories can be selected.",
      );
    }
    const knownCategories = new Set(BUILT_IN_PROBES.map((probe) => probe.category));
    const unknownCategories = [...options.categories].filter(
      (category) => !knownCategories.has(category),
    );
    if (unknownCategories.length > 0) {
      throw probeConfigError(
        "probe.selection.invalid",
        `Unknown probe categor${unknownCategories.length === 1 ? "y" : "ies"}: ${unknownCategories.sort().join(", ")}.`,
      );
    }
  }
  const selectedProbeCount = filterProbes(options).length;
  if ((options.samples ?? 5) * options.models.length * selectedProbeCount > MAX_PROBE_EXECUTIONS) {
    throw probeConfigError(
      "probe.workload.limit_exceeded",
      `The selected workload exceeds the ${MAX_PROBE_EXECUTIONS}-execution limit.`,
    );
  }
}

function assertBoundedPositiveInteger(value: number, option: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw probeConfigError(
      "probe.option.invalid",
      `${option} must be an integer between 1 and ${maximum}.`,
    );
  }
}

function probeConfigError(code: string, reason: string): AIDriftError {
  return new AIDriftError({
    code,
    exitCode: ExitCode.ConfigError,
    what: reason,
    why: "The requested probe run cannot produce correctly labeled, comparable evidence.",
    fix: "Correct the probe target, provider, or options and run again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function validateEvidenceIdentity(
  model: RunProviderProbesOptions["models"][number],
  probe: CanonicalProbe,
  providerId: string,
  baseline: ProbeBaseline | undefined,
): string | undefined {
  if (baseline === undefined) return undefined;
  if (
    baseline.provider === undefined ||
    baseline.model === undefined ||
    baseline.modelName === undefined ||
    baseline.probeId === undefined
  ) {
    return `Baseline identity is incomplete for ${model.name}/${probe.id}; capture a new baseline.`;
  }
  if (
    baseline.provider !== providerId ||
    baseline.model !== model.model ||
    baseline.modelName !== model.name ||
    baseline.probeId !== probe.id
  ) {
    return `Baseline identity mismatch for ${model.name}/${probe.id}: expected ${providerId}/${model.model}.`;
  }
  return undefined;
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

async function generateBeforeDeadline(
  provider: EvalProvider,
  request: Parameters<EvalProvider["generate"]>[0],
  deadlineMs: number,
): Promise<Awaited<ReturnType<EvalProvider["generate"]>>> {
  const remainingMs = deadlineMs - performance.now();
  if (remainingMs <= 0) throw probeTimeoutError();
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(probeTimeoutError());
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

class ProbeBudget {
  totalCostUsd = 0;
  unknownCostSamples = 0;
  private stoppedReason: AIDriftError | undefined;

  constructor(private readonly budgetUsd: number | undefined) {}

  assertCanContinue(): void {
    if (this.stoppedReason !== undefined) throw this.stoppedReason;
  }

  record(costUsd: number | undefined, probeId: string): void {
    if (costUsd === undefined) {
      this.unknownCostSamples += 1;
      if (this.budgetUsd !== undefined) {
        this.stoppedReason = probeBudgetError(
          "probe.cost.unknown",
          `Cannot enforce the probe budget for ${probeId} because observed cost is unknown.`,
        );
        throw this.stoppedReason;
      }
      return;
    }
    const next = this.totalCostUsd + costUsd;
    if (this.budgetUsd !== undefined && next > this.budgetUsd) {
      this.stoppedReason = probeBudgetError(
        "probe.budget.exceeded",
        `Observed probe cost $${next.toFixed(6)} exceeded budget $${this.budgetUsd.toFixed(6)}.`,
      );
      throw this.stoppedReason;
    }
    this.totalCostUsd = next;
  }
}

function probeTimeoutError(): AIDriftError {
  return new AIDriftError({
    code: "probe.timeout",
    exitCode: ExitCode.ConfigError,
    what: "The provider probe run exceeded its configured timeout.",
    why: "The provider did not complete every selected probe sample before the run deadline.",
    fix: "Increase the timeout or reduce models, probes, or samples.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function probeBudgetError(code: string, reason: string): AIDriftError {
  return new AIDriftError({
    code,
    exitCode: ExitCode.ConfigError,
    what: "The provider probe cost bound could not be maintained.",
    why: reason,
    fix: "Use a verified-price model, increase the budget, or reduce models, probes, or samples.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function formatProbeExecutionError(error: unknown): string {
  if (error instanceof AIDriftError) return `${error.what} ${error.why}`;
  return error instanceof Error ? error.message : "Probe execution failed.";
}
