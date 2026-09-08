import path from "node:path";

import { Command } from "commander";

import {
  AIDriftError,
  assertManifestRuntimeSupported,
  BUILT_IN_PROBES,
  ExitCode,
  estimateProbeCost,
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_SAMPLES,
  MAX_EVAL_TIMEOUT_MS,
  MAX_PROBE_CACHE_TTL_MINUTES,
  MAX_PROBE_EXECUTIONS,
  runProviderProbes,
  validateManifestFile,
  type AIStateManifest,
  type ManifestValidationIssue,
  type ProbeCategory,
  type ProbeModelTarget,
  type ProbeRunResult,
  type WritableStreamLike,
} from "@zettacore/aidrift-core";

import {
  buildLiveProvider,
  checkProviderEnvVar,
  enforceRunConfirmation,
  formatCostEstimate,
  formatCostEstimateJson,
  parseCostBudget,
  parseProviderId,
  type LiveProviderId,
} from "../provider-gate.js";
import { resolveCommandFormat, resolveCommandManifestPath } from "../config/command-config.js";

export interface RegisterProbeCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

interface ProbeCommandOptions {
  readonly config?: string | undefined;
  readonly model?: string | undefined;
  readonly category?: string | undefined;
  readonly samples?: string | undefined;
  readonly timeout?: string | undefined;
  readonly cacheTtl?: string | undefined;
  readonly cache?: boolean | undefined;
  readonly estimateCost?: boolean | undefined;
  readonly format?: string | undefined;
  readonly concurrency?: string | undefined;
  readonly provider?: string | undefined;
  readonly yes?: boolean | undefined;
  readonly costBudget?: string | undefined;
}

type ProbeFormat = "text" | "json";

export function registerProbeCommand(program: Command, options: RegisterProbeCommandOptions): void {
  program
    .command("probe")
    .description("Detect provider-side drift with canonical provider probes.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--model <name>", "Probe a specific model artifact name")
    .option(
      "--category <category>",
      "Probe category: deterministic, structural, semantic, behavioral, performance",
    )
    .option("--samples <n>", "Samples per probe", "5")
    .option("--timeout <seconds>", "Maximum total provider probe execution time")
    .option("--cache-ttl <mins>", "Cache TTL in minutes", "60")
    .option("--no-cache", "Disable probe result caching")
    .option("--estimate-cost", "Show estimated probe cost without running probes")
    .option("--format <fmt>", "Output format: text or json")
    .option("--concurrency <n>", "Maximum concurrent probes", "4")
    .option("--provider <provider>", "Provider: mock, openai, or anthropic", "mock")
    .option("--yes", "Confirm live provider run and accept estimated cost")
    .option(
      "--cost-budget <dollars>",
      "Maximum allowed cost in USD; exits 2 if estimate exceeds it",
    )
    .action(async (commandOptions: ProbeCommandOptions, cmd: Command) => {
      const merged = cmd.optsWithGlobals<ProbeCommandOptions>();
      const manifestPath = resolveCommandManifestPath(merged.config, options.env);
      const projectRoot = path.dirname(manifestPath);
      const validation = await validateManifestFile({ manifestPath });

      if (validation.manifest === undefined) {
        throw manifestValidationError(validation.errors, manifestPath);
      }

      const blockingErrors = validation.errors.filter(
        (issue) => !(issue.code === "manifest.path.missing" && issue.manifestPath === "eval.suite"),
      );
      if (blockingErrors.length > 0) {
        throw manifestValidationError(blockingErrors, manifestPath);
      }

      assertManifestRuntimeSupported(validation.manifest, "probe");

      const providerId = parseProviderId(merged.provider);
      const category = parseCategory(merged.category);
      const models = manifestModels(validation.manifest, merged.model);
      const estimateModels = modelsForProvider(models, providerId);
      const samples = parsePositiveInteger(merged.samples, 5, "--samples", MAX_EVAL_SAMPLES);
      const timeoutMs =
        parsePositiveInteger(
          merged.timeout,
          validation.manifest.eval.timeout_seconds ?? 30,
          "--timeout",
          MAX_EVAL_TIMEOUT_MS / 1_000,
        ) * 1_000;
      const format = parseProbeFormat(resolveCommandFormat(merged.format, options.env));
      const selectedProbes =
        category === undefined
          ? BUILT_IN_PROBES
          : BUILT_IN_PROBES.filter((probe) => probe.category === category);
      assertProbeWorkload(models.length, selectedProbes.length, samples);

      if (merged.estimateCost === true) {
        const estimate = estimateProbeCost({
          models: estimateModels,
          samples,
          probes: selectedProbes,
        });
        options.io.stdout.write(
          format === "json" ? formatCostEstimateJson(estimate) : formatCostEstimate(estimate),
        );
        return;
      }

      const isLive = providerId !== "mock";
      let providerForModel:
        | ((model: ProbeModelTarget) => ReturnType<typeof buildLiveProvider>)
        | undefined;
      let observedBudgetUsd: number | undefined;

      if (isLive) {
        const env: Readonly<Record<string, string | undefined>> = options.env ?? process.env;
        checkProviderEnvVar(providerId as LiveProviderId, env);
        const estimate = estimateProbeCost({
          models: estimateModels,
          samples,
          probes: selectedProbes,
        });
        const formattedEstimate = formatCostEstimate(estimate);
        if (format === "json") options.io.stderr.write(formattedEstimate);
        else options.io.stdout.write(formattedEstimate);
        enforceRunConfirmation(estimate, merged.yes, merged.costBudget);
        observedBudgetUsd = parseCostBudget(merged.costBudget);
        providerForModel = (model) =>
          buildLiveProvider(providerId as LiveProviderId, model, env, { timeoutMs });
      }

      const result = await runProviderProbes({
        projectRoot,
        storagePath: validation.manifest.storage.path,
        models,
        categories: category === undefined ? undefined : new Set([category]),
        samples,
        cacheTtlMinutes: parsePositiveInteger(
          merged.cacheTtl,
          60,
          "--cache-ttl",
          MAX_PROBE_CACHE_TTL_MINUTES,
        ),
        useCache: merged.cache !== false,
        concurrency: parsePositiveInteger(
          merged.concurrency,
          4,
          "--concurrency",
          MAX_EVAL_CONCURRENCY,
        ),
        timeoutMs,
        ...(observedBudgetUsd !== undefined ? { budgetUsd: observedBudgetUsd } : {}),
        providerForModel,
        allowProviderOverride: providerId === "mock",
      });

      if (result.summary.errors > 0) {
        throw probeRuntimeError(result.summary.errors);
      }

      if (format === "json") {
        options.io.stdout.write(`${formatProbeJson(result)}\n`);
      } else {
        options.io.stdout.write(formatProbeText(result));
      }

      if (result.hasDrift || result.summary.insufficient > 0) {
        process.exitCode = ExitCode.Failure;
      }
    });
}

function assertProbeWorkload(modelCount: number, probeCount: number, samples: number): void {
  if (modelCount * probeCount * samples > MAX_PROBE_EXECUTIONS) {
    throw probeOptionError(
      `The selected workload exceeds the ${MAX_PROBE_EXECUTIONS}-request probe limit.`,
    );
  }
}

function modelsForProvider(
  models: readonly ProbeModelTarget[],
  providerId: ReturnType<typeof parseProviderId>,
): readonly ProbeModelTarget[] {
  if (providerId === "mock") {
    return models.map((model) => ({ ...model, provider: "mock" }));
  }
  const mismatch = models.find((model) => model.provider !== providerId);
  if (mismatch !== undefined) {
    throw new AIDriftError({
      code: "probe.provider.model_mismatch",
      exitCode: ExitCode.ConfigError,
      what: `Model artifact ${mismatch.name} declares provider ${mismatch.provider}, not ${providerId}.`,
      why: "Estimating or executing with a different live provider would mislabel evidence.",
      fix: `Use --provider ${mismatch.provider} or correct the model artifact.`,
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return models;
}

function probeRuntimeError(errorCount: number): AIDriftError {
  return new AIDriftError({
    code: "probe.runtime_error",
    exitCode: ExitCode.ConfigError,
    what: "Provider probe execution failed.",
    why: `${errorCount} probe${errorCount === 1 ? "" : "s"} returned an execution error.`,
    fix: "Fix the provider configuration or connectivity, then run aidrift probe again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function manifestModels(
  manifest: AIStateManifest,
  selectedModel: string | undefined,
): readonly ProbeModelTarget[] {
  const models = Object.entries(manifest.artifacts.models ?? {}).map(([name, artifact]) => ({
    name,
    provider: artifact.provider,
    model: artifact.model,
    parameters: artifact.parameters,
  }));

  const filtered =
    selectedModel === undefined ? models : models.filter((model) => model.name === selectedModel);
  if (filtered.length > 0) {
    return filtered;
  }

  throw new AIDriftError({
    code: "probe.model.not_found",
    exitCode: ExitCode.ConfigError,
    what: `No model artifact found for probe target: ${selectedModel ?? "all"}`,
    why: "Provider probes require at least one model under artifacts.models.",
    fix: "Add a model artifact to .aistate.yml or pass --model with an existing model name.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function parseCategory(value: string | undefined): ProbeCategory | undefined {
  if (value === undefined) {
    return undefined;
  }

  const categories = new Set([
    "deterministic",
    "structural",
    "semantic",
    "behavioral",
    "performance",
  ]);
  if (categories.has(value)) {
    return value as ProbeCategory;
  }

  throw new AIDriftError({
    code: "probe.category.invalid",
    exitCode: ExitCode.ConfigError,
    what: `Unsupported probe category: ${value}`,
    why: "The requested category is not one of the built-in Phase 10 probe categories.",
    fix: "Use deterministic, structural, semantic, behavioral, or performance.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function parseProbeFormat(value: string | undefined): ProbeFormat {
  const format = (value ?? "text").trim().toLowerCase();
  if (format === "text" || format === "json") return format;
  throw new AIDriftError({
    code: "probe.format.unsupported",
    exitCode: ExitCode.ConfigError,
    what: `Unsupported probe output format: ${value ?? ""}`,
    why: "Only text and json probe formats are supported.",
    fix: "Use --format text or --format json.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function manifestValidationError(
  errors: readonly ManifestValidationIssue[],
  manifestPath: string,
): AIDriftError {
  const first = errors[0];
  return new AIDriftError({
    code: first?.code ?? "manifest.invalid",
    exitCode: ExitCode.ConfigError,
    what: `Cannot run probe for manifest: ${manifestPath}`,
    why: errors.length === 0 ? "Manifest validation failed." : errors.map(formatIssue).join("; "),
    fix: first?.fix ?? "Fix .aistate.yml and run aidrift probe again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function formatIssue(issue: ManifestValidationIssue): string {
  const location = issue.line === undefined ? "" : ` at line ${issue.line}`;
  return `[${issue.code}]${location} ${issue.message}`;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  option: string,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/u.test(value)) {
    throw probeOptionError(`${option} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw probeOptionError(`${option} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function probeOptionError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "probe.option.invalid",
    exitCode: ExitCode.ConfigError,
    what: "The probe command options are invalid.",
    why: reason,
    fix: "Review 'aidrift probe --help' and correct the option value.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function formatProbeText(result: ProbeRunResult): string {
  const lines = [
    "AIDRIFT Probe",
    `Provider: ${result.providerId}`,
    `Probes: ${result.summary.total}`,
    "",
  ];

  for (const item of result.results) {
    lines.push(
      `${item.modelName}/${item.probeId}\t${item.status}\t${item.score.toFixed(2)}\t${item.explanation}`,
    );
  }

  lines.push(
    "",
    `Summary: ${result.summary.passed} PASS, ${result.summary.warned} WARN, ${result.summary.drifted} DRIFT, ${result.summary.insufficient} INSUFFICIENT, ${result.summary.errors} ERROR, ${result.summary.new} NEW`,
  );

  return `${lines.join("\n")}\n`;
}

function formatProbeJson(result: ProbeRunResult): string {
  return JSON.stringify({
    providerId: result.providerId,
    baselineSnapshotId: result.baselineSnapshotId,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    requestedSamples: result.requestedSamples,
    totalCostUsd: result.totalCostUsd,
    unknownCostSamples: result.unknownCostSamples,
    summary: result.summary,
    results: result.results.map((item) => ({
      modelName: item.modelName,
      provider: item.provider,
      model: item.model,
      probeId: item.probeId,
      status: item.status,
      score: item.score,
      confidence: item.confidence,
      statistics: item.statistics,
      samples: item.samples,
    })),
  });
}
