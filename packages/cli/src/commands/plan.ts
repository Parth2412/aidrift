import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Command } from "commander";

import {
  AIDriftError,
  assertManifestRuntimeSupported,
  assertWritablePathWithinProject,
  BUILT_IN_PROBES,
  containsSecretLikeValue,
  ExitCode,
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_EXECUTIONS,
  MAX_EVAL_SAMPLES,
  MAX_EVAL_TIMEOUT_MS,
  MAX_PROBE_EXECUTIONS,
  estimateProbeCost,
  loadEvalSuite,
  runEvalPlan,
  runProviderProbes,
  validateManifestFile,
  type AIStateManifest,
  type ManifestValidationIssue,
  type PlanRunResult,
  type ProbeModelTarget,
  type ProbeRunResult,
  type WritableStreamLike,
} from "@zettacore/aidrift-core";

import { describeCliEvalTarget, resolveCliEvalTarget } from "../eval-target.js";
import { resolveCommandFormat, resolveCommandManifestPath } from "../config/command-config.js";

const MAX_SAVED_PLAN_BYTES = 64 * 1024 * 1024;
import {
  buildLiveProvider,
  checkProviderEnvVar,
  enforceRunConfirmation,
  formatCostEstimate,
  parseCostBudget,
  parseProviderId,
  type LiveProviderId,
} from "../provider-gate.js";

export interface RegisterPlanCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

interface PlanCommandOptions {
  readonly config?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly format?: string | undefined;
  readonly save?: boolean | undefined;
  readonly allowRegression?: string | undefined;
  readonly budget?: string | undefined;
  readonly probeProviders?: boolean | undefined;
  readonly assertions?: string | undefined;
  readonly tags?: string | undefined;
  readonly samples?: string | undefined;
  readonly timeout?: string | undefined;
  readonly concurrency?: string | undefined;
  readonly provider?: string | undefined;
  readonly yes?: boolean | undefined;
  readonly costBudget?: string | undefined;
}

export function registerPlanCommand(program: Command, options: RegisterPlanCommandOptions): void {
  program
    .command("plan")
    .description("Execute the declared eval target and compare sampled behavior to a baseline.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--assertions <ids>", "Run only specific assertions (comma-separated)")
    .option("--tags <tags>", "Run assertions matching tags (comma-separated)")
    .option("--samples <n>", "Override samples per assertion")
    .option("--allow-regression <ids>", "Mark assertion ids as intentionally regressed")
    .option("--budget <amount>", "Maximum eval cost in USD (for example, $0.50)")
    .option("--timeout <seconds>", "Maximum total eval execution time")
    .option("--dry-run", "Show what would be tested without invoking the provider")
    .option("--probe-providers", "Include provider drift probes")
    .option(
      "--provider <provider>",
      "Provider for --probe-providers: mock, openai, or anthropic",
      "mock",
    )
    .option("--yes", "Confirm live provider run and accept estimated cost")
    .option(
      "--cost-budget <dollars>",
      "Maximum allowed cost in USD; exits 2 if estimate exceeds it",
    )
    .option("--format <fmt>", "Output format: text or json")
    .option("--save", "Save results to .aidrift/results/")
    .option("--concurrency <n>", "Maximum concurrent assertions", "4")
    .action(async (commandOptions: PlanCommandOptions, cmd: Command) => {
      const planStartMs = performance.now();
      const merged = cmd.optsWithGlobals<PlanCommandOptions>();
      const format = parsePlanFormat(resolveCommandFormat(merged.format, options.env));

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

      assertManifestRuntimeSupported(validation.manifest, "plan");
      const env: Readonly<Record<string, string | undefined>> = options.env ?? process.env;
      const suitePath = path.resolve(projectRoot, validation.manifest.eval.suite);
      const samples = parsePositiveInteger(
        merged.samples,
        validation.manifest.eval.samples_per_assertion ?? 5,
        "--samples",
        MAX_EVAL_SAMPLES,
      );
      const timeoutSeconds = parsePositiveInteger(
        merged.timeout,
        validation.manifest.eval.timeout_seconds ?? 30,
        "--timeout",
        MAX_EVAL_TIMEOUT_MS / 1_000,
      );
      const deadlineMs = planStartMs + timeoutSeconds * 1_000;
      const budgetUsd = parseBudget(merged.budget);
      const assertionIds = parseCsvSet(merged.assertions, "--assertions");
      const tags = parseCsvSet(merged.tags, "--tags");
      const allowRegressionIds = parseCsvSet(merged.allowRegression, "--allow-regression");
      const evalTarget = await resolveCliEvalTarget({
        manifest: validation.manifest,
        projectRoot,
        env,
        timeoutMs: remainingPlanMilliseconds(deadlineMs),
        execute: merged.dryRun !== true,
      });

      if (evalTarget.providerId !== "mock" && merged.dryRun !== true) {
        const suite = await loadEvalSuite({ suitePath, projectRoot });
        const selectedAssertions = suite.assertions.filter(
          (assertion) =>
            (assertionIds === undefined || assertionIds.has(assertion.id)) &&
            (tags === undefined || assertion.tags?.some((tag) => tags.has(tag)) === true),
        );
        assertPlanWorkload(selectedAssertions.length, samples, MAX_EVAL_EXECUTIONS, "eval");
        const estimate = estimateProbeCost({
          models: [
            {
              name: evalTarget.target.modelName,
              provider: evalTarget.target.model.provider,
              model: evalTarget.target.model.model,
              parameters: evalTarget.target.model.parameters,
            },
          ],
          samples,
          probeCount: selectedAssertions.length,
          requestInputs: selectedAssertions.map((assertion) => assertion.input),
          inputTokenOverheadPerRequest: estimateTextTokens(evalTarget.target.systemPrompt ?? ""),
        });
        const formattedEstimate = formatEvalCostEstimate(estimate);
        if (format === "json") options.io.stderr.write(formattedEstimate);
        else options.io.stdout.write(formattedEstimate);
        enforceRunConfirmation(
          estimate,
          merged.yes,
          budgetUsd === undefined ? undefined : String(budgetUsd),
        );
      }

      const result = await runEvalPlan({
        projectRoot,
        storagePath: validation.manifest.storage.path,
        suitePath,
        dryRun: merged.dryRun === true,
        concurrency: parsePositiveInteger(
          merged.concurrency,
          4,
          "--concurrency",
          MAX_EVAL_CONCURRENCY,
        ),
        samples,
        significanceLevel: validation.manifest.eval.significance_level ?? 0.05,
        timeoutMs: remainingPlanMilliseconds(deadlineMs),
        budgetUsd,
        allowRegressionIds,
        assertionIds,
        tags,
        provider: evalTarget.provider,
        executionTarget: describeCliEvalTarget(evalTarget),
      });

      let probeResult: ProbeRunResult | undefined;
      if (merged.probeProviders === true) {
        const providerId = parseProviderId(merged.provider);
        const isLive = providerId !== "mock";
        const models = manifestModels(validation.manifest);
        const probeSamples = parsePositiveInteger(merged.samples, 5, "--samples", MAX_EVAL_SAMPLES);
        assertPlanWorkload(
          models.length * BUILT_IN_PROBES.length,
          probeSamples,
          MAX_PROBE_EXECUTIONS,
          "probe",
        );
        let providerForModel:
          | ((model: ProbeModelTarget) => ReturnType<typeof buildLiveProvider>)
          | undefined;

        if (isLive) {
          checkProviderEnvVar(providerId as LiveProviderId, env);
          const estimate = estimateProbeCost({ models, samples: probeSamples });
          const formattedEstimate = formatCostEstimate(estimate);
          if (format === "json") options.io.stderr.write(formattedEstimate);
          else options.io.stdout.write(formattedEstimate);
          enforceRunConfirmation(estimate, merged.yes, merged.costBudget);
          providerForModel = (model) =>
            buildLiveProvider(providerId as LiveProviderId, model, env, {
              timeoutMs: remainingPlanMilliseconds(deadlineMs),
            });
        }
        const probeBudgetUsd = parseCostBudget(merged.costBudget);

        probeResult = await runProviderProbes({
          projectRoot,
          storagePath: validation.manifest.storage.path,
          models,
          samples: probeSamples,
          useCache: false,
          cacheTtlMinutes: 0,
          concurrency: parsePositiveInteger(
            merged.concurrency,
            4,
            "--concurrency",
            MAX_EVAL_CONCURRENCY,
          ),
          timeoutMs: remainingPlanMilliseconds(deadlineMs),
          ...(probeBudgetUsd !== undefined ? { budgetUsd: probeBudgetUsd } : {}),
          providerForModel,
          allowProviderOverride: providerId === "mock",
        });
        if (probeResult.summary.errors > 0) {
          throw probeRuntimeError(probeResult.summary.errors);
        }
      }

      if (merged.save === true) {
        await savePlanResult(projectRoot, result, probeResult);
      }

      if (format === "json") {
        options.io.stdout.write(`${formatPlanJson(result, probeResult)}\n`);
      } else {
        options.io.stdout.write(formatPlanText(result, probeResult));
      }

      if (
        result.hasRegressions ||
        probeResult?.hasDrift === true ||
        (probeResult?.summary.insufficient ?? 0) > 0
      ) {
        process.exitCode = ExitCode.Failure;
      }
    });
}

function assertPlanWorkload(
  operationCount: number,
  samples: number,
  maximum: number,
  kind: "eval" | "probe",
): void {
  if (operationCount * samples > maximum) {
    throw planOptionError(`The selected ${kind} workload exceeds the ${maximum}-request limit.`);
  }
}

function probeRuntimeError(errorCount: number): AIDriftError {
  return new AIDriftError({
    code: "plan.probe.runtime_error",
    exitCode: ExitCode.ConfigError,
    what: "Provider probe execution failed during plan.",
    why: `${errorCount} probe${errorCount === 1 ? "" : "s"} returned an execution error.`,
    fix: "Fix the provider configuration or connectivity, then run aidrift plan again.",
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
    what: `Cannot run plan for manifest: ${manifestPath}`,
    why: errors.length === 0 ? "Manifest validation failed." : errors.map(formatIssue).join("; "),
    fix: first?.fix ?? "Fix .aistate.yml and run aidrift plan again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function estimateTextTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 4);
}

function formatIssue(issue: ManifestValidationIssue): string {
  const location = issue.line === undefined ? "" : ` at line ${issue.line}`;
  return `[${issue.code}]${location} ${issue.message}`;
}

function parseCsvSet(value: string | undefined, option: string): ReadonlySet<string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw planOptionError(`${option} must contain at least one value.`);
  }
  return new Set(entries);
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
    throw planOptionError(`${option} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw planOptionError(`${option} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function parseBudget(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().replace(/^\$/u, "");
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) {
    throw planOptionError("--budget must be a finite non-negative USD amount.");
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw planOptionError("--budget must be a finite non-negative USD amount.");
  }
  return parsed;
}

function planOptionError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "plan.option.invalid",
    exitCode: ExitCode.ConfigError,
    what: "The plan command options are invalid.",
    why: reason,
    fix: "Review 'aidrift plan --help' and correct the option value.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function formatEvalCostEstimate(estimate: ReturnType<typeof estimateProbeCost>): string {
  return [
    "AIDRIFT Eval Cost Estimate",
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

function manifestModels(manifest: AIStateManifest): readonly ProbeModelTarget[] {
  return Object.entries(manifest.artifacts.models ?? {}).map(([name, artifact]) => ({
    name,
    provider: artifact.provider,
    model: artifact.model,
    parameters: artifact.parameters,
  }));
}

function formatPlanText(result: PlanRunResult, probeResult: ProbeRunResult | undefined): string {
  const lines = [
    "AIDRIFT Plan",
    `Suite: ${result.suitePath}`,
    `Provider: ${result.providerId}`,
    ...(result.executionTarget === undefined
      ? []
      : [
          `Target: ${result.executionTarget.modelName} (${result.executionTarget.model})`,
          `Prompts: ${result.executionTarget.promptNames.length === 0 ? "none" : result.executionTarget.promptNames.join(", ")}`,
        ]),
    `Assertions: ${result.summary.total}`,
    `Samples per assertion: ${result.requestedSamples}`,
    "",
  ];

  for (const item of result.results) {
    const baseline =
      item.baselineScore === undefined
        ? "new"
        : `${item.baselineScore.toFixed(2)} -> ${item.score.toFixed(2)}`;
    const evidence =
      item.statistics === undefined
        ? ""
        : ` [${item.statistics.method} p=${item.statistics.pValue.toFixed(6)}, alpha=${item.statistics.significanceLevel.toFixed(3)}, ${item.statistics.significant ? "significant" : "not significant"}]`;
    lines.push(`${item.assertionId}\t${item.status}\t${baseline}\t${item.explanation}${evidence}`);
  }

  lines.push(
    "",
    `Summary: ${result.summary.passed} PASS, ${result.summary.warned} WARN, ${result.summary.failed} FAIL, ${result.summary.new} NEW`,
    `Observed cost: $${result.totalCostUsd.toFixed(6)}${result.unknownCostSamples > 0 ? ` (${result.unknownCostSamples} sample costs unknown)` : ""}`,
  );

  if (probeResult !== undefined) {
    const probeSamples = probeResult.results[0]?.samples.length ?? 1;
    lines.push(
      `Provider probes: ${probeResult.summary.total}`,
      `Probe summary: ${probeResult.summary.passed} PASS, ${probeResult.summary.warned} WARN, ${probeResult.summary.drifted} DRIFT, ${probeResult.summary.insufficient} INSUFFICIENT, ${probeResult.summary.errors} ERROR, ${probeResult.summary.new} NEW`,
      `Probe requests: ${probeResult.summary.total * probeSamples}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatPlanJson(result: PlanRunResult, probeResult: ProbeRunResult | undefined): string {
  return JSON.stringify({
    schemaVersion: "1",
    providerId: result.providerId,
    requestedSamples: result.requestedSamples,
    significanceLevel: result.significanceLevel,
    totalCostUsd: result.totalCostUsd,
    unknownCostSamples: result.unknownCostSamples,
    executionTarget: result.executionTarget,
    summary: result.summary,
    results: result.results.map((item) => ({
      assertionId: item.assertionId,
      status: item.status,
      score: item.score,
      baselineScore: item.baselineScore,
      delta: item.delta,
      statistics: item.statistics,
    })),
    probeSummary: probeResult?.summary,
    probeResults: probeResult?.results.map((item) => ({
      modelName: item.modelName,
      probeId: item.probeId,
      status: item.status,
    })),
  });
}

async function savePlanResult(
  projectRoot: string,
  result: PlanRunResult,
  probeResult: ProbeRunResult | undefined,
): Promise<void> {
  const dir = path.join(projectRoot, ".aidrift", "results");
  const filename = path.join(
    dir,
    `plan_${fileTimestamp(new Date())}_${randomUUID().slice(0, 8)}.json`,
  );
  const serialized = JSON.stringify(
    probeResult === undefined ? result : { ...result, probes: probeResult },
    null,
    2,
  );
  if (Buffer.byteLength(serialized, "utf8") > MAX_SAVED_PLAN_BYTES) {
    throw new AIDriftError({
      code: "plan.output.too_large",
      exitCode: ExitCode.ConfigError,
      what: "Plan evidence exceeds the saved-output safety limit.",
      why: `Serialized evidence is larger than ${MAX_SAVED_PLAN_BYTES} bytes.`,
      fix: "Reduce samples, selected assertions, probes, or provider output size and retry.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  if (containsSecretLikeValue(serialized)) {
    throw new AIDriftError({
      code: "plan.output.secret_detected",
      exitCode: ExitCode.ConfigError,
      what: "Secret-like content detected in plan evidence.",
      why: "Saved plan files contain sampled model output and are persisted on disk.",
      fix: "Remove secret-bearing model output or run without --save after correcting the target.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }

  await assertWritablePathWithinProject(projectRoot, filename, "Saved plan evidence");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await assertWritablePathWithinProject(projectRoot, filename, "Saved plan evidence");
  await fs.writeFile(filename, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await fs.chmod(filename, 0o600);
}

function parsePlanFormat(value: string | undefined): "text" | "json" {
  if (value === undefined || value === "text" || value === "json") return value ?? "text";
  throw new AIDriftError({
    code: "plan.format.unsupported",
    exitCode: ExitCode.ConfigError,
    what: `Unsupported plan output format: ${value}.`,
    why: "The plan command supports text and json output only.",
    fix: "Use --format text or --format json.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function remainingPlanMilliseconds(deadlineMs: number): number {
  const remaining = Math.floor(deadlineMs - performance.now());
  if (remaining < 1) {
    throw new AIDriftError({
      code: "plan.timeout",
      exitCode: ExitCode.ConfigError,
      what: "The plan exceeded its total wall-clock deadline.",
      why: "Validation, evals, and provider probes did not finish within --timeout.",
      fix: "Increase --timeout or reduce assertions, models, probes, or samples.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return remaining;
}

function fileTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hour = pad2(date.getUTCHours());
  const minute = pad2(date.getUTCMinutes());
  const second = pad2(date.getUTCSeconds());
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
