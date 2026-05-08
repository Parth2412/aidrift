import path from "node:path";

import { Command } from "commander";

import {
  AIDriftError,
  ExitCode,
  estimateProbeCost,
  runProviderProbes,
  validateManifestFile,
  type AIStateManifest,
  type EvalProvider,
  type ManifestValidationIssue,
  type ProbeCategory,
  type ProbeModelTarget,
  type ProbeRunResult,
  type WritableStreamLike,
} from "@aidrift/core";

import {
  buildLiveProvider,
  checkProviderEnvVar,
  enforceRunConfirmation,
  formatCostEstimate,
  parseProviderId,
  type LiveProviderId,
} from "../provider-gate.js";

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
  readonly cacheTtl?: string | undefined;
  readonly cache?: boolean | undefined;
  readonly estimateCost?: boolean | undefined;
  readonly format?: string | undefined;
  readonly concurrency?: string | undefined;
  readonly provider?: string | undefined;
  readonly yes?: boolean | undefined;
  readonly costBudget?: string | undefined;
}

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
    .option("--cache-ttl <mins>", "Cache TTL in minutes", "60")
    .option("--no-cache", "Disable probe result caching")
    .option("--estimate-cost", "Show estimated probe cost without running probes")
    .option("--format <fmt>", "Output format: text or json", "text")
    .option("--concurrency <n>", "Maximum concurrent probes", "4")
    .option("--provider <provider>", "Provider: mock, openai, or anthropic", "mock")
    .option("--yes", "Confirm live provider run and accept estimated cost")
    .option(
      "--cost-budget <dollars>",
      "Maximum allowed cost in USD; exits 2 if estimate exceeds it",
    )
    .action(async (commandOptions: ProbeCommandOptions, cmd: Command) => {
      const merged = cmd.optsWithGlobals<ProbeCommandOptions>();
      const manifestPath = path.resolve(merged.config ?? path.join(process.cwd(), ".aistate.yml"));
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

      const providerId = parseProviderId(merged.provider);
      const category = parseCategory(merged.category);
      const models = manifestModels(validation.manifest, merged.model);
      const samples = parsePositiveInteger(merged.samples, 5);
      const selectedProbeCount = category === undefined ? undefined : 4;

      if (merged.estimateCost === true) {
        const estimate = estimateProbeCost({ models, samples, probeCount: selectedProbeCount });
        options.io.stdout.write(formatCostEstimate(estimate));
        return;
      }

      const isLive = providerId !== "mock";
      let liveProvider: EvalProvider | undefined;

      if (isLive) {
        const env: Readonly<Record<string, string | undefined>> = options.env ?? process.env;
        checkProviderEnvVar(providerId as LiveProviderId, env);
        const estimate = estimateProbeCost({ models, samples, probeCount: selectedProbeCount });
        options.io.stdout.write(formatCostEstimate(estimate));
        enforceRunConfirmation(estimate, merged.yes, merged.costBudget);
        liveProvider = buildLiveProvider(providerId as LiveProviderId, models, env);
      }

      const result = await runProviderProbes({
        projectRoot,
        models,
        categories: category === undefined ? undefined : new Set([category]),
        samples,
        cacheTtlMinutes: parsePositiveInteger(merged.cacheTtl, 60),
        useCache: merged.cache !== false,
        concurrency: parsePositiveInteger(merged.concurrency, 4),
        provider: liveProvider,
      });

      const format = merged.format ?? "text";
      if (format === "json") {
        options.io.stdout.write(`${formatProbeJson(result)}\n`);
      } else if (format === "text") {
        options.io.stdout.write(formatProbeText(result));
      } else {
        throw new AIDriftError({
          code: "probe.format.unsupported",
          exitCode: ExitCode.ConfigError,
          what: `Unsupported probe output format: ${format}`,
          why: "Phase 10 supports text and json probe output only.",
          fix: "Use --format text or --format json.",
          docs: "../aidrift-docs/DEVELOPMENT-ROADMAP.md",
        });
      }

      if (result.hasDrift) {
        process.exitCode = ExitCode.Failure;
      }
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
    docs: "../aidrift-docs/MANIFEST-SPEC.md",
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
    docs: "../aidrift-docs/DEVELOPMENT-ROADMAP.md",
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
    docs: "../aidrift-docs/MANIFEST-SPEC.md",
  });
}

function formatIssue(issue: ManifestValidationIssue): string {
  const location = issue.line === undefined ? "" : ` at line ${issue.line}`;
  return `[${issue.code}]${location} ${issue.message}`;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    `Summary: ${result.summary.passed} PASS, ${result.summary.drifted} DRIFT, ${result.summary.errors} ERROR, ${result.summary.new} NEW`,
  );

  return `${lines.join("\n")}\n`;
}

function formatProbeJson(result: ProbeRunResult): string {
  return JSON.stringify({
    summary: result.summary,
    results: result.results.map((item) => ({
      modelName: item.modelName,
      probeId: item.probeId,
      status: item.status,
    })),
  });
}
