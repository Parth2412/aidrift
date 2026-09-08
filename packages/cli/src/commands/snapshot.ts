import path from "node:path";
import { performance } from "node:perf_hooks";

import { Command } from "commander";

import {
  AIDriftError,
  assertManifestRuntimeSupported,
  attachBehavioralBaselines,
  BUILT_IN_PROBES,
  captureSnapshot,
  estimateProbeCost,
  ExitCode,
  loadEvalSuite,
  MAX_EVAL_SAMPLES,
  MAX_EVAL_EXECUTIONS,
  MAX_PROBE_EXECUTIONS,
  runEvalPlan,
  runProviderProbes,
  type AIStateManifest,
  type EvalProvider,
  type ManifestValidationIssue,
  type PlanRunResult,
  type ProbeCostEstimate,
  type ProbeModelTarget,
  type ProbeRunResult,
  validateManifestFile,
  writeSnapshot,
  type WritableStreamLike,
} from "@zettacore/aidrift-core";

import { describeCliEvalTarget, resolveCliEvalTarget, type CliEvalTarget } from "../eval-target.js";
import {
  buildLiveProvider,
  checkProviderEnvVar,
  enforceRunConfirmation,
  parseCostBudget,
  parseProviderId,
  type LiveProviderId,
  type ProbeProviderId,
} from "../provider-gate.js";
import { CLI_VERSION } from "../program.js";
import { resolveCommandManifestPath } from "../config/command-config.js";

export interface RegisterSnapshotCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

interface SnapshotCommandOptions {
  readonly config?: string;
  readonly label?: string;
  readonly message?: string;
  readonly tags?: string;
  readonly withEvals?: boolean;
  readonly withProbes?: boolean;
  readonly provider?: string;
  readonly samples?: string;
  readonly yes?: boolean;
  readonly costBudget?: string;
}

interface BaselineExecution {
  readonly providerId: ProbeProviderId;
  readonly evalResult?: PlanRunResult | undefined;
  readonly probeResult?: ProbeRunResult | undefined;
}

export function registerSnapshotCommand(
  program: Command,
  options: RegisterSnapshotCommandOptions,
): void {
  program
    .command("snapshot")
    .description("Capture artifact state and optional behavioral baselines.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--label <label>", "Human-readable label for this snapshot")
    .option("-m, --message <message>", "Description for this snapshot")
    .option("--tags <tags>", "Comma-separated snapshot tags")
    .option("--with-evals", "Capture evaluation baselines")
    .option("--with-probes", "Capture provider-drift probe baselines")
    .option("--provider <provider>", "Baseline provider: mock, openai, or anthropic", "mock")
    .option("--samples <n>", "Samples per eval assertion and provider probe", "5")
    .option("--yes", "Confirm live provider calls and accept estimated cost")
    .option(
      "--cost-budget <dollars>",
      "Maximum allowed live baseline cost in USD; exits 2 when exceeded",
    )
    .action(async (commandOptions: SnapshotCommandOptions, cmd: Command) => {
      const merged = cmd.optsWithGlobals<SnapshotCommandOptions>();
      const manifestPath = resolveCommandManifestPath(merged.config, options.env);
      const projectRoot = path.dirname(manifestPath);
      const validation = await validateManifestFile({ manifestPath });

      if (validation.manifest === undefined) {
        throw manifestValidationError(validation.errors, manifestPath);
      }
      const blockingErrors = validation.errors.filter(
        (issue) =>
          !(
            merged.withEvals !== true &&
            issue.code === "manifest.path.missing" &&
            issue.manifestPath === "eval.suite"
          ),
      );
      if (blockingErrors.length > 0) {
        throw manifestValidationError(blockingErrors, manifestPath);
      }

      assertManifestRuntimeSupported(validation.manifest, "snapshot");
      if (merged.withEvals === true) {
        assertManifestRuntimeSupported(validation.manifest, "plan");
      }
      if (merged.withProbes === true) {
        assertManifestRuntimeSupported(validation.manifest, "probe");
      }

      const tags = parseTags(merged.tags);
      const providerId = parseProviderId(merged.provider);
      const samples = parsePositiveInteger(merged.samples, "--samples", MAX_EVAL_SAMPLES);
      const artifactSnapshot = await captureSnapshot({
        manifest: validation.manifest,
        manifestPath,
        projectRoot,
        cliVersion: CLI_VERSION,
        label: merged.label,
        message: merged.message,
        tags,
      });
      const baselineExecution = await executeBaselines({
        manifest: validation.manifest,
        projectRoot,
        withEvals: merged.withEvals === true,
        withProbes: merged.withProbes === true,
        providerId,
        samples,
        yes: merged.yes,
        costBudget: merged.costBudget,
        env: options.env ?? process.env,
        io: options.io,
      });

      const snapshot = attachBehavioralBaselines({
        snapshot: artifactSnapshot,
        evalResult: baselineExecution.evalResult,
        probeResult: baselineExecution.probeResult,
      });

      await writeSnapshot(projectRoot, snapshot, validation.manifest.storage.path);

      const artifactCount = Object.keys(snapshot.artifacts).length;
      const evalCount = Object.keys(snapshot.eval?.baselines ?? {}).length;
      const probeCount = Object.keys(snapshot.probe?.baselines ?? {}).length;
      options.io.stdout.write(
        `Snapshot created: ${snapshot.id}\n` +
          `  Artifacts: ${artifactCount}\n` +
          `  Timestamp: ${snapshot.timestamp}\n` +
          (snapshot.label !== undefined ? `  Label: ${snapshot.label}\n` : "") +
          (snapshot.tags !== undefined ? `  Tags: ${snapshot.tags.join(", ")}\n` : "") +
          (merged.withEvals === true || merged.withProbes === true
            ? `  Baseline provider: ${baselineExecution.providerId}${baselineExecution.providerId === "mock" ? " (offline synthetic)" : " (live)"}\n`
            : "") +
          (merged.withEvals === true ? `  Eval baselines: ${evalCount}\n` : "") +
          (merged.withProbes === true ? `  Probe baselines: ${probeCount}\n` : "") +
          (snapshot.metadata.gitCommit !== undefined
            ? `  Git commit: ${snapshot.metadata.gitCommit}\n`
            : ""),
      );
    });
}

async function executeBaselines(options: {
  readonly manifest: AIStateManifest;
  readonly projectRoot: string;
  readonly withEvals: boolean;
  readonly withProbes: boolean;
  readonly providerId: ProbeProviderId;
  readonly samples: number;
  readonly yes: boolean | undefined;
  readonly costBudget: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: RegisterSnapshotCommandOptions["io"];
}): Promise<BaselineExecution> {
  if (!options.withEvals && !options.withProbes) {
    return { providerId: options.providerId };
  }

  const models = manifestModels(options.manifest);
  if (options.withProbes && models.length === 0) {
    throw baselineOptionError("--with-probes requires at least one model under artifacts.models.");
  }
  const suitePath = path.resolve(options.projectRoot, options.manifest.eval.suite);
  const suite = options.withEvals
    ? await loadEvalSuite({ suitePath, projectRoot: options.projectRoot })
    : undefined;
  if (options.withEvals && suite?.assertions.length === 0) {
    throw baselineOptionError("--with-evals requires at least one executable assertion.");
  }

  let evalProvider: EvalProvider | undefined;
  let evalTarget: CliEvalTarget | undefined;
  let providerForModel: ((model: ProbeModelTarget) => EvalProvider) | undefined;
  const timeoutMs = (options.manifest.eval.timeout_seconds ?? 30) * 1_000;
  const deadlineMs = performance.now() + timeoutMs;
  const observedBudgetUsd = parseCostBudget(options.costBudget);
  if (options.withEvals) {
    evalTarget = await resolveCliEvalTarget({
      manifest: options.manifest,
      projectRoot: options.projectRoot,
      env: options.env,
      providerOverride: options.providerId,
      timeoutMs,
    });
    evalProvider = evalTarget.provider;
  }
  if (options.providerId !== "mock") {
    const providerId = options.providerId as LiveProviderId;
    checkProviderEnvVar(providerId, options.env);
    const liveProviders = new Map(
      models.map((model) => [
        model.name,
        buildLiveProvider(providerId, model, options.env, { timeoutMs }),
      ]),
    );
    if (options.withProbes) {
      providerForModel = (model) => liveProviders.get(model.name)!;
    }

    const estimate = combinedCostEstimate(
      evalTarget === undefined
        ? undefined
        : {
            name: evalTarget.target.modelName,
            provider: evalTarget.target.model.provider,
            model: evalTarget.target.model.model,
            parameters: evalTarget.target.model.parameters,
          },
      models,
      suite?.assertions.map((assertion) => assertion.input) ?? [],
      evalTarget?.target.systemPrompt ?? "",
      options.withProbes,
      options.samples,
    );
    options.io.stdout.write(formatBaselineCostEstimate(estimate));
    enforceRunConfirmation(estimate.total, options.yes, options.costBudget);
  }

  const evalResult = options.withEvals
    ? await runEvalPlan({
        projectRoot: options.projectRoot,
        storagePath: options.manifest.storage.path,
        suitePath,
        provider: evalProvider,
        samples: options.samples,
        significanceLevel: options.manifest.eval.significance_level ?? 0.05,
        timeoutMs: remainingBaselineMilliseconds(deadlineMs),
        ...(observedBudgetUsd !== undefined ? { budgetUsd: observedBudgetUsd } : {}),
        ...(evalTarget === undefined ? {} : { executionTarget: describeCliEvalTarget(evalTarget) }),
      })
    : undefined;
  const remainingBudgetUsd =
    observedBudgetUsd === undefined
      ? undefined
      : Math.max(0, observedBudgetUsd - (evalResult?.totalCostUsd ?? 0));
  const probeResult = options.withProbes
    ? await runProviderProbes({
        projectRoot: options.projectRoot,
        storagePath: options.manifest.storage.path,
        models,
        samples: options.samples,
        useCache: false,
        cacheTtlMinutes: 0,
        timeoutMs: remainingBaselineMilliseconds(deadlineMs),
        ...(remainingBudgetUsd !== undefined ? { budgetUsd: remainingBudgetUsd } : {}),
        providerForModel,
        allowProviderOverride: options.providerId === "mock",
      })
    : undefined;
  if (probeResult !== undefined && probeResult.summary.errors > 0) {
    throw new AIDriftError({
      code: "snapshot.probe.runtime_error",
      exitCode: ExitCode.ConfigError,
      what: "Provider probe execution failed while capturing a baseline.",
      why: `${probeResult.summary.errors} probe${probeResult.summary.errors === 1 ? "" : "s"} returned an execution error.`,
      fix: "Fix provider configuration/connectivity and capture the snapshot again.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }

  return { providerId: options.providerId, evalResult, probeResult };
}

function remainingBaselineMilliseconds(deadlineMs: number): number {
  const remaining = Math.floor(deadlineMs - performance.now());
  if (remaining < 1) {
    throw new AIDriftError({
      code: "snapshot.baseline.timeout",
      exitCode: ExitCode.ConfigError,
      what: "Behavioral baseline capture exceeded its wall-clock deadline.",
      why: "Eval and probe sampling did not finish within eval.timeout_seconds.",
      fix: "Increase eval.timeout_seconds or reduce assertions, models, probes, or samples.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return remaining;
}

function combinedCostEstimate(
  evalModel: ProbeModelTarget | undefined,
  models: readonly ProbeModelTarget[],
  evalRequestInputs: readonly string[],
  evalSystemPrompt: string,
  withProbes: boolean,
  samples: number,
): {
  readonly evalRequests: number;
  readonly probeRequests: number;
  readonly total: ProbeCostEstimate;
} {
  if (evalRequestInputs.length * samples > MAX_EVAL_EXECUTIONS) {
    throw baselineOptionError(
      `The selected eval workload exceeds the ${MAX_EVAL_EXECUTIONS}-request limit.`,
    );
  }
  if (withProbes && models.length * BUILT_IN_PROBES.length * samples > MAX_PROBE_EXECUTIONS) {
    throw baselineOptionError(
      `The selected probe workload exceeds the ${MAX_PROBE_EXECUTIONS}-request limit.`,
    );
  }
  const evalEstimate = estimateProbeCost({
    models: evalModel === undefined ? [] : [evalModel],
    samples,
    probeCount: evalRequestInputs.length,
    requestInputs: evalRequestInputs,
    inputTokenOverheadPerRequest: Math.ceil(Buffer.byteLength(evalSystemPrompt, "utf8") / 4),
  });
  const probeEstimate = withProbes
    ? estimateProbeCost({ models, samples })
    : estimateProbeCost({ models: [], samples, probeCount: 0 });
  return {
    evalRequests: evalEstimate.requestCount,
    probeRequests: probeEstimate.requestCount,
    total: {
      modelCount: models.length,
      probeCount: probeEstimate.probeCount,
      samples,
      requestCount: evalEstimate.requestCount + probeEstimate.requestCount,
      estimatedInputTokens: evalEstimate.estimatedInputTokens + probeEstimate.estimatedInputTokens,
      estimatedOutputTokens:
        evalEstimate.estimatedOutputTokens + probeEstimate.estimatedOutputTokens,
      ...(evalEstimate.estimatedUsd !== undefined && probeEstimate.estimatedUsd !== undefined
        ? { estimatedUsd: evalEstimate.estimatedUsd + probeEstimate.estimatedUsd }
        : {}),
      unknownModels: [...new Set([...evalEstimate.unknownModels, ...probeEstimate.unknownModels])],
      pricingAsOf: evalEstimate.pricingAsOf,
    },
  };
}

function formatBaselineCostEstimate(estimate: {
  readonly evalRequests: number;
  readonly probeRequests: number;
  readonly total: ProbeCostEstimate;
}): string {
  return [
    "AIDRIFT Baseline Cost Estimate",
    `Eval requests: ${estimate.evalRequests}`,
    `Probe requests: ${estimate.probeRequests}`,
    `Estimated requests: ${estimate.total.requestCount}`,
    `Estimated input tokens: ${estimate.total.estimatedInputTokens}`,
    `Estimated output tokens: ${estimate.total.estimatedOutputTokens}`,
    `Pricing verified: ${estimate.total.pricingAsOf}`,
    estimate.total.estimatedUsd === undefined
      ? `Estimated cost: unknown (${estimate.total.unknownModels.join(", ")})`
      : `Estimated cost: $${estimate.total.estimatedUsd.toFixed(6)}`,
    "",
  ].join("\n");
}

function manifestModels(manifest: AIStateManifest): readonly ProbeModelTarget[] {
  return Object.entries(manifest.artifacts.models ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, artifact]) => ({
      name,
      provider: artifact.provider,
      model: artifact.model,
      parameters: artifact.parameters,
    }));
}

function parsePositiveInteger(value: string | undefined, option: string, maximum: number): number {
  const raw = value ?? "5";
  if (!/^\d+$/u.test(raw)) {
    throw baselineOptionError(`${option} must be a positive integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw baselineOptionError(`${option} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function parseTags(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const tags = [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].sort();
  if (tags.length === 0) {
    throw baselineOptionError("--tags must contain at least one non-empty tag.");
  }
  return tags;
}

function baselineOptionError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "snapshot.baseline.option_invalid",
    exitCode: ExitCode.ConfigError,
    what: "Cannot capture the requested behavioral baseline.",
    why: reason,
    fix: "Review 'aidrift snapshot --help' and correct the manifest or options.",
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
    what: `Cannot capture snapshot for manifest: ${manifestPath}`,
    why: errors.length === 0 ? "Manifest validation failed." : errors.map(formatIssue).join("; "),
    fix: first?.fix ?? "Fix .aistate.yml and run aidrift snapshot again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function formatIssue(issue: ManifestValidationIssue): string {
  const location = issue.line === undefined ? "" : ` at line ${issue.line}`;
  return `[${issue.code}]${location} ${issue.message}`;
}
