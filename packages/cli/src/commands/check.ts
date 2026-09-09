import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Command } from "commander";

import {
  AIDriftError,
  assertManifestRuntimeSupported,
  BUILT_IN_PROBES,
  captureSnapshot,
  createMockProvider,
  diffSnapshots,
  estimateProbeCost,
  ExitCode,
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_EXECUTIONS,
  MAX_EVAL_SAMPLES,
  MAX_EVAL_TIMEOUT_MS,
  MAX_PROBE_EXECUTIONS,
  loadEvalSuite,
  listSnapshots,
  redactSecrets,
  readSnapshot,
  runEvalPlan,
  runProviderProbes,
  type AIStateManifest,
  validateManifestFile,
  type AssertionEvalResult,
  type Assertion,
  type CanonicalProbe,
  type ManifestValidationIssue,
  type PlanRunResult,
  type PlanRunSummary,
  type EvalProvider,
  type EvalSuite,
  type ProbeCategory,
  type ProbeCostEstimate,
  type ProbeModelTarget,
  type ProbeResult,
  type ProbeRunResult,
  type ProbeRunSummary,
  type SnapshotSummary,
  type SnapshotDiffResult,
  type WritableStreamLike,
} from "@zettacore/aidrift-core";

import { resolveCommandFormat, resolveCommandManifestPath } from "../config/command-config.js";

import { describeCliEvalTarget, resolveCliEvalTarget, type CliEvalTarget } from "../eval-target.js";
import {
  buildLiveProvider,
  checkProviderEnvVar,
  parseCostBudget,
  type LiveProviderId,
} from "../provider-gate.js";
import { CLI_VERSION } from "../program.js";

export interface RegisterCheckCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

interface CheckCommandOptions {
  readonly config?: string | undefined;
  readonly format?: string | undefined;
  readonly baseline?: string | undefined;
  readonly output?: string | undefined;
  readonly failOn?: string | undefined;
  readonly assertions?: string | undefined;
  readonly tags?: string | undefined;
  readonly samples?: string | undefined;
  readonly probeModel?: string | undefined;
  readonly probeCategory?: string | undefined;
  readonly concurrency?: string | undefined;
  readonly timeout?: string | undefined;
  readonly costBudget?: string | undefined;
}

type CheckFormat = "text" | "json" | "junit" | "github";
type FailOn = "fail" | "warn";

interface CheckRunResult {
  readonly evals: PlanRunResult;
  readonly probes: ProbeRunResult;
  readonly baselineSnapshotId: string;
  readonly passed: boolean;
  readonly failOn: FailOn;
  readonly artifacts: SnapshotDiffResult;
  readonly estimate: ProbeCostEstimate;
  readonly timeoutSeconds: number;
  readonly concurrency: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export function registerCheckCommand(program: Command, options: RegisterCheckCommandOptions): void {
  program
    .command("check")
    .description("CI/CD quality gate: run evals against latest baseline, exit 1 on regression.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--format <fmt>", "Output format: text, json, junit, or github")
    .option("--baseline <sha-or-tag>", "Snapshot id, label, tag, or git SHA to use as baseline")
    .option("--output <path>", "Also write formatted output to this file")
    .option("--fail-on <level>", "Failure threshold: fail (default) or warn", "fail")
    .option("--assertions <ids>", "Run only specific assertion IDs (comma-separated)")
    .option("--tags <tags>", "Run only assertions matching tags (comma-separated)")
    .option("--samples <n>", "Samples per assertion and provider probe")
    .option("--probe-model <name>", "Run probes only for one model artifact")
    .option(
      "--probe-category <category>",
      "Probe category: deterministic, structural, semantic, behavioral, performance",
    )
    .option("--concurrency <n>", "Maximum concurrent evals and probes", "4")
    .option("--timeout <seconds>", "Total wall-clock execution deadline")
    .option(
      "--cost-budget <dollars>",
      "Required maximum USD cost for live providers; unknown cost fails closed",
    )
    .action(async (commandOptions: CheckCommandOptions, cmd: Command) => {
      const checkStartedAt = new Date();
      const checkStartMs = performance.now();
      const merged = cmd.optsWithGlobals<CheckCommandOptions>();
      const manifestPath = resolveCommandManifestPath(merged.config, options.env);
      const projectRoot = path.dirname(manifestPath);
      const format = parseFormat(resolveCommandFormat(merged.format, options.env));
      const failOn = parseFailOn(merged.failOn);
      const concurrency = parsePositiveInteger(
        merged.concurrency,
        4,
        "--concurrency",
        MAX_EVAL_CONCURRENCY,
      );
      const assertionIds = parseCsvSet(merged.assertions);
      const tags = parseCsvSet(merged.tags);
      const probeCategory = parseProbeCategory(merged.probeCategory);
      const budgetUsd = parseCostBudget(merged.costBudget);

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

      assertManifestRuntimeSupported(validation.manifest, "check");

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
      const deadlineMs = checkStartMs + timeoutSeconds * 1_000;
      const storagePath = validation.manifest.storage.path;
      const baselineSnapshotId = await resolveBaseline(projectRoot, storagePath, merged.baseline);
      const baselineSnapshot = await readSnapshot(projectRoot, baselineSnapshotId, storagePath);
      const currentSnapshot = await captureSnapshot({
        manifest: validation.manifest,
        manifestPath,
        projectRoot,
        cliVersion: CLI_VERSION,
      });
      const artifacts = diffSnapshots(baselineSnapshot, currentSnapshot);
      const models = selectProbeModels(manifestModels(validation.manifest), merged.probeModel);
      const env = options.env ?? process.env;
      const evalTarget = await resolveCliEvalTarget({
        manifest: validation.manifest,
        projectRoot,
        env,
        timeoutMs: timeoutSeconds * 1_000,
      });
      const providerForModel = resolveCheckProviders(models, env, timeoutSeconds * 1_000);

      const suitePath = path.resolve(projectRoot, validation.manifest.eval.suite);
      const suite = await loadEvalSuite({ suitePath, projectRoot });
      const selectedAssertions = selectAssertionsForEstimate(suite, assertionIds, tags);
      const selectedProbes =
        probeCategory === undefined
          ? BUILT_IN_PROBES
          : BUILT_IN_PROBES.filter((probe) => probe.category === probeCategory);
      const estimate = combinedCheckCostEstimate(
        evalTarget,
        models,
        selectedAssertions.map((assertion) => assertion.input),
        selectedProbes,
        samples,
      );
      enforceCheckCostBound(estimate, budgetUsd, hasLiveExecution(evalTarget.providerId, models));

      const evals = await runEvalPlan({
        projectRoot,
        storagePath,
        suitePath,
        concurrency,
        samples,
        significanceLevel: validation.manifest.eval.significance_level ?? 0.05,
        timeoutMs: remainingMilliseconds(deadlineMs),
        budgetUsd,
        assertionIds,
        tags,
        baselineSnapshotId,
        provider: evalTarget.provider,
        executionTarget: describeCliEvalTarget(evalTarget),
      });
      const remainingBudget =
        budgetUsd === undefined ? undefined : Math.max(0, budgetUsd - evals.totalCostUsd);
      const probes = await runProviderProbes({
        projectRoot,
        storagePath,
        models,
        categories: probeCategory === undefined ? undefined : new Set([probeCategory]),
        samples,
        significanceLevel: validation.manifest.eval.significance_level ?? 0.05,
        cacheTtlMinutes: 0,
        useCache: false,
        concurrency,
        timeoutMs: remainingMilliseconds(deadlineMs),
        budgetUsd: remainingBudget,
        baselineSnapshotId,
        providerForModel,
      });

      const passed = computePassed(evals.summary, probes.summary, failOn);
      if (probes.summary.errors > 0) {
        throw new AIDriftError({
          code: "check.probe.runtime_error",
          exitCode: ExitCode.ConfigError,
          what: "Provider probe execution failed.",
          why: `${probes.summary.errors} probe${probes.summary.errors === 1 ? "" : "s"} returned an execution error.`,
          fix: "Fix the provider or manifest configuration, then re-run aidrift check.",
          docs: "https://github.com/Parth2412/aidrift#readme",
        });
      }
      const result: CheckRunResult = {
        evals,
        probes,
        baselineSnapshotId,
        passed,
        failOn,
        artifacts,
        estimate,
        timeoutSeconds,
        concurrency,
        startedAt: checkStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - checkStartMs),
      };
      const formatted = renderOutput(result, format, manifestPath);
      const safe = redactSecrets(formatted);

      options.io.stdout.write(safe);

      if (merged.output !== undefined) {
        const outputPath = path.resolve(merged.output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, safe, { encoding: "utf8", mode: 0o600 });
        await fs.chmod(outputPath, 0o600);
      }

      if (!passed) {
        process.exitCode = ExitCode.Failure;
      }
    });
}

async function resolveBaseline(
  projectRoot: string,
  storagePath: string,
  baselineArg: string | undefined,
): Promise<string> {
  const snapshots = await listSnapshots(projectRoot, storagePath);
  if (baselineArg !== undefined) {
    const found = await findSnapshotBaseline(projectRoot, storagePath, snapshots, baselineArg);
    if (found !== undefined) {
      return found;
    }
    throw new AIDriftError({
      code: "check.baseline.not_found",
      exitCode: ExitCode.ConfigError,
      what: `Baseline not found: ${baselineArg}`,
      why: "No snapshot id, label, tag, or git commit matched the requested baseline.",
      fix: "Run 'aidrift history' to list snapshots, then pass a valid --baseline value.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }

  const latest = snapshots[0];
  if (latest === undefined) {
    throw new AIDriftError({
      code: "check.baseline.missing",
      exitCode: ExitCode.ConfigError,
      what: "No snapshot found to use as baseline.",
      why: "aidrift check requires at least one snapshot to compare against.",
      fix: "Run 'aidrift snapshot' to capture a baseline, then re-run check.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }

  return latest.id;
}

async function findSnapshotBaseline(
  projectRoot: string,
  storagePath: string,
  snapshots: readonly SnapshotSummary[],
  baselineArg: string,
): Promise<string | undefined> {
  const requested = baselineArg.trim();
  for (const summary of snapshots) {
    if (
      summary.id === requested ||
      summary.label === requested ||
      summary.gitCommit === requested ||
      summary.gitCommit?.startsWith(requested) === true
    ) {
      return summary.id;
    }

    const snapshot = await readSnapshot(projectRoot, summary.id, storagePath);
    if (snapshot.tags?.includes(requested) === true) {
      return snapshot.id;
    }
  }
  return undefined;
}

function computePassed(
  evalSummary: PlanRunSummary,
  probeSummary: ProbeRunSummary,
  failOn: FailOn,
): boolean {
  if (failOn === "warn") {
    return (
      evalSummary.failed === 0 &&
      evalSummary.warned === 0 &&
      probeSummary.warned === 0 &&
      probeSummary.drifted === 0 &&
      probeSummary.insufficient === 0
    );
  }
  return evalSummary.failed === 0 && probeSummary.drifted === 0 && probeSummary.insufficient === 0;
}

function parseFormat(value: string | undefined): CheckFormat {
  const fmt = (value ?? "text").trim().toLowerCase();
  if (fmt === "text" || fmt === "json" || fmt === "junit" || fmt === "github") {
    return fmt;
  }
  throw new AIDriftError({
    code: "check.format.unsupported",
    exitCode: ExitCode.ConfigError,
    what: `Unsupported check output format: ${value ?? ""}`,
    why: "Only text, json, junit, and github formats are supported.",
    fix: "Use --format text, --format json, --format junit, or --format github.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function parseFailOn(value: string | undefined): FailOn {
  const level = (value ?? "fail").trim().toLowerCase();
  if (level === "fail" || level === "warn") {
    return level;
  }
  throw new AIDriftError({
    code: "check.fail-on.invalid",
    exitCode: ExitCode.ConfigError,
    what: `Invalid --fail-on value: ${value ?? ""}`,
    why: "Only 'fail' and 'warn' are valid thresholds.",
    fix: "Use --fail-on fail or --fail-on warn.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function parseCsvSet(value: string | undefined): ReadonlySet<string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const entries = value
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  return new Set(entries);
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  flag: string,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value.trim())) {
    throw checkOptionError(`${flag} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw checkOptionError(`${flag} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function parseProbeCategory(value: string | undefined): ProbeCategory | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  const known = new Set(BUILT_IN_PROBES.map((probe) => probe.category));
  if (known.has(normalized as ProbeCategory)) return normalized as ProbeCategory;
  throw checkOptionError(
    "--probe-category must be deterministic, structural, semantic, behavioral, or performance.",
  );
}

function checkOptionError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "check.option.invalid",
    exitCode: ExitCode.ConfigError,
    what: "The check command options are invalid.",
    why: reason,
    fix: "Correct the check flags and run the command again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function selectAssertionsForEstimate(
  suite: EvalSuite,
  assertionIds: ReadonlySet<string> | undefined,
  tags: ReadonlySet<string> | undefined,
): readonly Assertion[] {
  const knownIds = new Set(suite.assertions.map((assertion) => assertion.id));
  const unknownIds = [...(assertionIds ?? [])].filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw checkOptionError(`Unknown assertion id(s): ${unknownIds.sort().join(", ")}.`);
  }
  const selected = suite.assertions.filter(
    (assertion) =>
      (assertionIds === undefined || assertionIds.has(assertion.id)) &&
      (tags === undefined || assertion.tags?.some((tag) => tags.has(tag)) === true),
  );
  if (tags !== undefined && selected.length === 0) {
    throw checkOptionError("The selected eval tags did not match any assertions.");
  }
  return selected;
}

function manifestModels(manifest: AIStateManifest): readonly ProbeModelTarget[] {
  const models = Object.entries(manifest.artifacts.models ?? {}).map(([name, artifact]) => ({
    name,
    provider: artifact.provider,
    model: artifact.model,
    parameters: artifact.parameters,
  }));

  if (models.length > 0) {
    return models;
  }

  throw new AIDriftError({
    code: "check.model.missing",
    exitCode: ExitCode.ConfigError,
    what: "No model artifacts found for check probes.",
    why: "aidrift check runs provider probes and requires at least one model artifact.",
    fix: "Add artifacts.models to .aistate.yml, then re-run aidrift check.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function selectProbeModels(
  models: readonly ProbeModelTarget[],
  selectedName: string | undefined,
): readonly ProbeModelTarget[] {
  if (selectedName === undefined) return models;
  const selected = models.filter((model) => model.name === selectedName);
  if (selected.length === 0) {
    throw checkOptionError(`Unknown probe model artifact: ${selectedName}.`);
  }
  return selected;
}

function resolveCheckProviders(
  models: readonly ProbeModelTarget[],
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs: number,
): (model: ProbeModelTarget) => EvalProvider {
  const unsupported = models.filter(
    (model) =>
      model.provider !== "mock" && model.provider !== "openai" && model.provider !== "anthropic",
  );
  if (unsupported.length > 0) {
    throw new AIDriftError({
      code: "check.provider.unsupported",
      exitCode: ExitCode.ConfigError,
      what: `Unsupported check provider: ${unsupported[0]!.provider}.`,
      why: "Silently replacing an unsupported manifest provider with the mock provider would create false passing evidence.",
      fix: "Use a mock, openai, or anthropic model artifact, or run a supported external target when target execution is available.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }

  const providers = new Map<string, EvalProvider>();
  for (const model of models) {
    if (model.provider === "mock") {
      providers.set(
        model.name,
        createMockProvider({ model: model.model, parameters: model.parameters }),
      );
      continue;
    }
    const providerId = model.provider as LiveProviderId;
    checkProviderEnvVar(providerId, env);
    providers.set(model.name, buildLiveProvider(providerId, model, env, { timeoutMs }));
  }

  return (model) => providers.get(model.name)!;
}

function combinedCheckCostEstimate(
  evalTarget: CliEvalTarget,
  probeModels: readonly ProbeModelTarget[],
  evalInputs: readonly string[],
  probes: readonly CanonicalProbe[],
  samples: number,
): ProbeCostEstimate {
  if (evalInputs.length * samples > MAX_EVAL_EXECUTIONS) {
    throw checkOptionError(
      `The selected eval workload exceeds the ${MAX_EVAL_EXECUTIONS}-request limit.`,
    );
  }
  if (probeModels.length * probes.length * samples > MAX_PROBE_EXECUTIONS) {
    throw checkOptionError(
      `The selected probe workload exceeds the ${MAX_PROBE_EXECUTIONS}-request limit.`,
    );
  }
  const evalEstimate = estimateProbeCost({
    models: [
      {
        name: evalTarget.target.modelName,
        provider: evalTarget.target.model.provider,
        model: evalTarget.target.model.model,
        parameters: evalTarget.target.model.parameters,
      },
    ],
    samples,
    probeCount: evalInputs.length,
    requestInputs: evalInputs,
    inputTokenOverheadPerRequest: estimateTextTokens(evalTarget.target.systemPrompt ?? ""),
  });
  const probeEstimate = estimateProbeCost({ models: probeModels, samples, probes });
  return {
    modelCount: new Set([
      `${evalTarget.target.model.provider}/${evalTarget.target.model.model}`,
      ...probeModels.map((model) => `${model.provider}/${model.model}`),
    ]).size,
    probeCount: probes.length,
    samples,
    requestCount: evalEstimate.requestCount + probeEstimate.requestCount,
    estimatedInputTokens: evalEstimate.estimatedInputTokens + probeEstimate.estimatedInputTokens,
    estimatedOutputTokens: evalEstimate.estimatedOutputTokens + probeEstimate.estimatedOutputTokens,
    ...(evalEstimate.estimatedUsd !== undefined && probeEstimate.estimatedUsd !== undefined
      ? { estimatedUsd: evalEstimate.estimatedUsd + probeEstimate.estimatedUsd }
      : {}),
    unknownModels: [
      ...new Set([...evalEstimate.unknownModels, ...probeEstimate.unknownModels]),
    ].sort(),
    pricingAsOf: evalEstimate.pricingAsOf,
  };
}

function hasLiveExecution(evalProviderId: string, models: readonly ProbeModelTarget[]): boolean {
  return evalProviderId !== "mock" || models.some((model) => model.provider !== "mock");
}

function enforceCheckCostBound(
  estimate: ProbeCostEstimate,
  budgetUsd: number | undefined,
  live: boolean,
): void {
  if (!live) return;
  if (budgetUsd === undefined) {
    throw new AIDriftError({
      code: "check.cost_budget.required",
      exitCode: ExitCode.ConfigError,
      what: "Live-provider checks require --cost-budget.",
      why: "A non-interactive CI gate must have an explicit, enforceable spending ceiling.",
      fix: "Inspect an estimate with aidrift probe --estimate-cost, then set --cost-budget=<dollars>.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  if (estimate.estimatedUsd === undefined) {
    throw new AIDriftError({
      code: "check.cost.unknown",
      exitCode: ExitCode.ConfigError,
      what: "The live check cost cannot be bounded for every selected model.",
      why: `No verified price is available for: ${estimate.unknownModels.join(", ")}.`,
      fix: "Use models with verified pricing before running them in non-interactive CI.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  if (estimate.estimatedUsd > budgetUsd) {
    throw new AIDriftError({
      code: "check.budget.exceeded",
      exitCode: ExitCode.ConfigError,
      what: `Estimated check cost $${estimate.estimatedUsd.toFixed(6)} exceeds budget $${budgetUsd.toFixed(6)}.`,
      why: "The selected CI workload would exceed its explicit spending ceiling.",
      fix: "Increase --cost-budget or reduce assertions, models, probe categories, or samples.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
}

function remainingMilliseconds(deadlineMs: number): number {
  const remaining = Math.floor(deadlineMs - performance.now());
  if (remaining < 1) {
    throw new AIDriftError({
      code: "check.timeout",
      exitCode: ExitCode.ConfigError,
      what: "The check exceeded its total wall-clock deadline.",
      why: "Validation, artifact capture, evals, and probes did not finish within --timeout.",
      fix: "Increase --timeout or reduce assertions, models, probes, or samples.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return remaining;
}

function estimateTextTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 4);
}

function manifestValidationError(
  errors: readonly ManifestValidationIssue[],
  manifestPath: string,
): AIDriftError {
  const first = errors[0];
  return new AIDriftError({
    code: first?.code ?? "manifest.invalid",
    exitCode: ExitCode.ConfigError,
    what: `Cannot run check for manifest: ${manifestPath}`,
    why: errors.length === 0 ? "Manifest validation failed." : errors.map(formatIssue).join("; "),
    fix: first?.fix ?? "Fix .aistate.yml and re-run aidrift check.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function formatIssue(issue: ManifestValidationIssue): string {
  const location = issue.line === undefined ? "" : ` at line ${issue.line}`;
  return `[${issue.code}]${location} ${issue.message}`;
}

function renderOutput(result: CheckRunResult, format: CheckFormat, manifestPath: string): string {
  switch (format) {
    case "text":
      return renderText(result);
    case "json":
      return renderJson(result);
    case "junit":
      return renderJunit(result);
    case "github":
      return renderGithub(result, manifestPath);
  }
}

function renderText(result: CheckRunResult): string {
  const lines = [
    "AIDRIFT Check",
    `Baseline: ${result.baselineSnapshotId}`,
    `Artifact changes: ${result.artifacts.changedCount} (informational)`,
    `Assertions: ${result.evals.summary.total}`,
    `Probes: ${result.probes.summary.total}`,
    `Execution bound: ${result.timeoutSeconds}s, concurrency ${result.concurrency}, ${result.evals.requestedSamples} samples`,
    `Estimated requests: ${result.estimate.requestCount}`,
    result.estimate.estimatedUsd === undefined
      ? `Estimated cost: unknown (${result.estimate.unknownModels.join(", ")})`
      : `Estimated cost: $${result.estimate.estimatedUsd.toFixed(6)}`,
    "",
  ];

  for (const item of result.artifacts.artifacts) {
    if (item.status !== "unchanged") {
      lines.push(`artifact:${item.artifactKey}\t${item.status.toUpperCase()}\t${item.kind}`);
    }
  }
  if (result.artifacts.changedCount > 0) lines.push("");

  for (const item of result.evals.results) {
    const baseline =
      item.baselineScore === undefined
        ? "new"
        : `${item.baselineScore.toFixed(2)} -> ${item.score.toFixed(2)}`;
    lines.push(
      `${item.assertionId}\t${item.status}\t${baseline}\t${item.explanation}${formatEvidenceSuffix(item.statistics)}`,
    );
  }

  if (result.probes.results.length > 0) {
    lines.push("");
    for (const item of result.probes.results) {
      const baseline =
        item.baselineScore === undefined
          ? "new"
          : `${item.baselineScore.toFixed(2)} -> ${item.score.toFixed(2)}`;
      lines.push(
        `${item.modelName}/${item.probeId}\t${item.status}\t${baseline}\t${item.explanation}${formatEvidenceSuffix(item.statistics)}`,
      );
    }
  }

  const regressionNote =
    result.evals.summary.regressions + result.probes.summary.drifted > 0
      ? ` (${result.evals.summary.regressions + result.probes.summary.drifted} regression${
          result.evals.summary.regressions + result.probes.summary.drifted === 1 ? "" : "s"
        })`
      : "";

  lines.push(
    "",
    `Summary: ${result.evals.summary.passed} PASS, ${result.evals.summary.warned} WARN, ${result.evals.summary.failed} FAIL, ${result.evals.summary.new} NEW; probes ${result.probes.summary.passed} PASS, ${result.probes.summary.warned} WARN, ${result.probes.summary.drifted} DRIFT, ${result.probes.summary.insufficient} INSUFFICIENT, ${result.probes.summary.errors} ERROR, ${result.probes.summary.new} NEW${regressionNote}`,
    result.passed ? "Result: PASS" : "Result: FAIL",
  );

  return `${lines.join("\n")}\n`;
}

function renderJson(result: CheckRunResult): string {
  const output = {
    schemaVersion: "3",
    passed: result.passed,
    failOn: result.failOn,
    baselineSnapshotId: result.baselineSnapshotId,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    execution: {
      samples: result.evals.requestedSamples,
      timeoutSeconds: result.timeoutSeconds,
      concurrency: result.concurrency,
      estimatedRequests: result.estimate.requestCount,
      estimatedInputTokens: result.estimate.estimatedInputTokens,
      estimatedOutputTokens: result.estimate.estimatedOutputTokens,
      ...(result.estimate.estimatedUsd === undefined
        ? { costEstimateKnown: false, unknownModels: result.estimate.unknownModels }
        : { costEstimateKnown: true, estimatedCostUsd: result.estimate.estimatedUsd }),
      observedCostUsd: result.evals.totalCostUsd + result.probes.totalCostUsd,
      unknownObservedCostSamples:
        result.evals.unknownCostSamples + result.probes.unknownCostSamples,
      pricingAsOf: result.estimate.pricingAsOf,
    },
    artifacts: {
      gate: "informational",
      summary: {
        total: result.artifacts.artifacts.length,
        changed: result.artifacts.changedCount,
        unchanged: result.artifacts.unchangedCount,
        added: result.artifacts.addedCount,
        removed: result.artifacts.removedCount,
      },
      results: result.artifacts.artifacts.map((item) => ({
        artifactKey: item.artifactKey,
        status: item.status,
        kind: item.kind,
      })),
    },
    summary: result.evals.summary,
    results: result.evals.results.map(
      (
        item,
      ): {
        readonly assertionId: string;
        readonly type: string;
        readonly status: string;
        readonly score: number;
        readonly baselineScore?: number;
        readonly providerId: string;
        readonly sampleCount: number;
        readonly latencyMs: number;
        readonly costUsd: number;
        readonly statistics?: AssertionEvalResult["statistics"];
        readonly explanation: string;
        readonly critical: boolean;
        readonly tags: readonly string[];
      } => ({
        assertionId: item.assertionId,
        type: item.type,
        status: item.status,
        score: item.score,
        ...(item.baselineScore !== undefined ? { baselineScore: item.baselineScore } : {}),
        providerId: item.providerId,
        sampleCount: item.samples.length,
        latencyMs: item.latencyMs,
        costUsd: item.costUsd,
        ...(item.statistics !== undefined ? { statistics: item.statistics } : {}),
        explanation: item.explanation,
        critical: item.critical,
        tags: item.tags,
      }),
    ),
    probes: {
      summary: result.probes.summary,
      results: result.probes.results.map(
        (
          item,
        ): {
          readonly modelName: string;
          readonly provider: string;
          readonly model: string;
          readonly probeId: string;
          readonly category: string;
          readonly status: string;
          readonly score: number;
          readonly baselineScore?: number;
          readonly sampleCount: number;
          readonly confidence: number;
          readonly explanation: string;
          readonly statistics?: ProbeResult["statistics"];
        } => ({
          modelName: item.modelName,
          provider: item.provider,
          model: item.model,
          probeId: item.probeId,
          category: item.category,
          status: item.status,
          score: item.score,
          ...(item.baselineScore !== undefined ? { baselineScore: item.baselineScore } : {}),
          sampleCount: item.samples.length,
          confidence: item.confidence,
          explanation: item.explanation,
          ...(item.statistics !== undefined ? { statistics: item.statistics } : {}),
        }),
      ),
    },
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}

function renderJunit(result: CheckRunResult): string {
  const totalMs = result.durationMs;
  const totalSec = (totalMs / 1000).toFixed(3);
  const failures =
    result.evals.summary.failed +
    (result.failOn === "warn" ? result.evals.summary.warned : 0) +
    result.probes.summary.drifted +
    result.probes.summary.insufficient +
    (result.failOn === "warn" ? result.probes.summary.warned : 0) +
    result.probes.summary.errors;
  const total = result.evals.summary.total + result.probes.summary.total;
  const timestamp = result.startedAt;

  const testcases = [
    ...result.evals.results.map((item) => renderJunitEvalTestcase(item, result.failOn)),
    ...result.probes.results.map((item) => renderJunitProbeTestcase(item, result.failOn)),
  ].join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="aidrift-check" tests="${total}" failures="${failures}" errors="0" time="${totalSec}">`,
    `  <testsuite name="aidrift" tests="${total}" failures="${failures}" errors="0" skipped="0" time="${totalSec}" timestamp="${timestamp}">`,
    testcases,
    `  </testsuite>`,
    `</testsuites>`,
    "",
  ].join("\n");
}

function renderJunitEvalTestcase(item: AssertionEvalResult, failOn: FailOn): string {
  const timeSec = (item.latencyMs / 1000).toFixed(3);
  const open = `    <testcase name="${xmlEscape(item.assertionId)}" classname="aidrift.check" time="${timeSec}">`;
  const empty = `    <testcase name="${xmlEscape(item.assertionId)}" classname="aidrift.check" time="${timeSec}" />`;
  const close = `    </testcase>`;

  if (
    item.status === "PASS" ||
    item.status === "NEW" ||
    (item.status === "WARN" && failOn === "fail")
  ) {
    return empty;
  }

  const failType = item.status === "FAIL" ? "regression" : "warning";
  const baselineScore = item.baselineScore ?? 0;
  const baselineNote = `score dropped from ${baselineScore.toFixed(2)} to ${item.score.toFixed(2)}`;
  const message = `${baselineNote} (${item.status})`;
  const body = xmlEscape(item.explanation);

  return [
    open,
    `      <failure message="${xmlEscape(message)}" type="${failType}">${body}</failure>`,
    close,
  ].join("\n");
}

function renderJunitProbeTestcase(item: ProbeResult, failOn: FailOn): string {
  const sampleLatency = item.samples.reduce((total, sample) => total + sample.latencyMs, 0);
  const timeSec = (sampleLatency / 1000).toFixed(3);
  const name = `${item.modelName}/${item.probeId}`;
  const open = `    <testcase name="${xmlEscape(name)}" classname="aidrift.check" time="${timeSec}">`;
  const empty = `    <testcase name="${xmlEscape(name)}" classname="aidrift.check" time="${timeSec}" />`;
  const close = `    </testcase>`;

  if (
    item.status === "PASS" ||
    item.status === "NEW" ||
    (item.status === "WARN" && failOn === "fail")
  ) {
    return empty;
  }

  const baselineScore = item.baselineScore ?? 0;
  const failType = item.status === "DRIFT" ? "drift" : item.status.toLowerCase();
  const baselineNote = `score changed from ${baselineScore.toFixed(2)} to ${item.score.toFixed(2)}`;
  const message = `${baselineNote} (${item.status})`;

  return [
    open,
    `      <failure message="${xmlEscape(message)}" type="${failType}">${xmlEscape(item.explanation)}</failure>`,
    close,
  ].join("\n");
}

function renderGithub(result: CheckRunResult, manifestPath: string): string {
  const relativeManifest = path.relative(process.cwd(), manifestPath).replace(/\\/gu, "/");
  const lines: string[] = [];

  for (const item of result.artifacts.artifacts) {
    if (item.status !== "unchanged") {
      const msg = `aidrift[artifact/${item.artifactKey}]: ${item.status} (${item.kind}); artifact state is informational and behavioral results determine the gate`;
      lines.push(formatGithubAnnotation("notice", relativeManifest, msg));
    }
  }

  for (const item of result.evals.results) {
    if (item.status === "WARN") {
      const msg = `aidrift[${item.assertionId}]: ${item.explanation}`;
      lines.push(formatGithubAnnotation("warning", relativeManifest, msg));
    } else if (item.status === "FAIL") {
      const msg = `aidrift[${item.assertionId}]: ${item.explanation}`;
      lines.push(formatGithubAnnotation("error", relativeManifest, msg));
    }
  }

  for (const item of result.probes.results) {
    if (item.status === "DRIFT") {
      const msg = `aidrift[${item.modelName}/${item.probeId}]: ${item.explanation}`;
      lines.push(formatGithubAnnotation("error", relativeManifest, msg));
    } else if (item.status === "WARN" || item.status === "INSUFFICIENT") {
      const msg = `aidrift[${item.modelName}/${item.probeId}]: ${item.explanation}`;
      lines.push(formatGithubAnnotation("warning", relativeManifest, msg));
    }
  }

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function formatGithubAnnotation(
  level: "notice" | "warning" | "error",
  file: string,
  message: string,
): string {
  return `::${level} file=${escapeGithubProperty(file)},line=1::${escapeGithubData(message)}`;
}

function escapeGithubProperty(value: string): string {
  return escapeGithubData(value).replace(/:/gu, "%3A").replace(/,/gu, "%2C");
}

function escapeGithubData(value: string): string {
  return value.replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function formatEvidenceSuffix(
  statistics:
    | { readonly pValue: number; readonly confidenceInterval: readonly number[] }
    | undefined,
): string {
  if (statistics === undefined) return "";
  return ` [p=${statistics.pValue.toFixed(6)}, CI=${statistics.confidenceInterval[0]?.toFixed(4)}..${statistics.confidenceInterval[1]?.toFixed(4)}]`;
}
