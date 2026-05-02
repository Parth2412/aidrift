import fs from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import {
  AIDriftError,
  ExitCode,
  runProviderProbes,
  runEvalPlan,
  validateManifestFile,
  type AIStateManifest,
  type ManifestValidationIssue,
  type PlanRunResult,
  type ProbeModelTarget,
  type ProbeRunResult,
  type WritableStreamLike,
} from "@aidrift/core";

export interface RegisterPlanCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
}

interface PlanCommandOptions {
  readonly config?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly format?: string | undefined;
  readonly save?: boolean | undefined;
  readonly allowRegression?: string | undefined;
  readonly probeProviders?: boolean | undefined;
  readonly assertions?: string | undefined;
  readonly tags?: string | undefined;
  readonly samples?: string | undefined;
  readonly concurrency?: string | undefined;
}

export function registerPlanCommand(program: Command, options: RegisterPlanCommandOptions): void {
  program
    .command("plan")
    .description("Preview behavioral impact with the offline Phase 9 eval runner.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--assertions <ids>", "Run only specific assertions (comma-separated)")
    .option("--tags <tags>", "Run assertions matching tags (comma-separated)")
    .option(
      "--samples <n>",
      "Accepted for CLI compatibility; Phase 9 uses one deterministic sample",
    )
    .option("--allow-regression <ids>", "Mark assertion ids as intentionally regressed")
    .option("--budget <amount>", "Accepted for CLI compatibility; no provider costs in Phase 9")
    .option("--timeout <seconds>", "Accepted for CLI compatibility")
    .option("--dry-run", "Show what would be tested without invoking the mock provider")
    .option("--probe-providers", "Include Phase 10 mocked provider drift probes")
    .option("--format <fmt>", "Output format: text or json", "text")
    .option("--save", "Save results to .aidrift/results/")
    .option("--concurrency <n>", "Maximum concurrent assertions", "4")
    .action(async (commandOptions: PlanCommandOptions, cmd: Command) => {
      const merged = cmd.optsWithGlobals<PlanCommandOptions>();

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

      const suitePath = path.resolve(projectRoot, validation.manifest.eval.suite);
      const result = await runEvalPlan({
        projectRoot,
        suitePath,
        dryRun: merged.dryRun === true,
        concurrency: parsePositiveInteger(merged.concurrency, 4),
        allowRegressionIds: parseCsvSet(merged.allowRegression),
        assertionIds: parseCsvSet(merged.assertions),
        tags: parseCsvSet(merged.tags),
      });
      const probeResult =
        merged.probeProviders === true
          ? await runProviderProbes({
              projectRoot,
              models: manifestModels(validation.manifest),
              samples: parsePositiveInteger(merged.samples, 5),
            })
          : undefined;

      if (merged.save === true) {
        await savePlanResult(projectRoot, result);
      }

      const format = merged.format ?? "text";
      if (format === "json") {
        options.io.stdout.write(`${formatPlanJson(result, probeResult)}\n`);
      } else if (format === "text") {
        options.io.stdout.write(formatPlanText(result, probeResult));
      } else {
        throw new AIDriftError({
          code: "plan.format.unsupported",
          exitCode: ExitCode.ConfigError,
          what: `Unsupported plan output format: ${format}`,
          why: "Phase 9 supports text and json plan output only.",
          fix: "Use --format text or --format json.",
        });
      }

      if (result.hasRegressions || probeResult?.hasDrift === true) {
        process.exitCode = ExitCode.Failure;
      }
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
    docs: "../aidrift-docs/MANIFEST-SPEC.md",
  });
}

function formatIssue(issue: ManifestValidationIssue): string {
  const location = issue.line === undefined ? "" : ` at line ${issue.line}`;
  return `[${issue.code}]${location} ${issue.message}`;
}

function parseCsvSet(value: string | undefined): ReadonlySet<string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return new Set(entries);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    `Assertions: ${result.summary.total}`,
    "",
  ];

  for (const item of result.results) {
    const baseline =
      item.baselineScore === undefined
        ? "new"
        : `${item.baselineScore.toFixed(2)} -> ${item.score.toFixed(2)}`;
    lines.push(`${item.assertionId}\t${item.status}\t${baseline}\t${item.explanation}`);
  }

  lines.push(
    "",
    `Summary: ${result.summary.passed} PASS, ${result.summary.warned} WARN, ${result.summary.failed} FAIL, ${result.summary.new} NEW`,
  );

  if (probeResult !== undefined) {
    const probeSamples = probeResult.results[0]?.samples.length ?? 1;
    lines.push(
      `Provider probes: ${probeResult.summary.total}`,
      `Probe summary: ${probeResult.summary.passed} PASS, ${probeResult.summary.drifted} DRIFT, ${probeResult.summary.errors} ERROR, ${probeResult.summary.new} NEW`,
      `Probe requests: ${probeResult.summary.total * probeSamples}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatPlanJson(result: PlanRunResult, probeResult: ProbeRunResult | undefined): string {
  return JSON.stringify({
    summary: result.summary,
    results: result.results.map((item) => ({
      assertionId: item.assertionId,
      status: item.status,
    })),
    probeSummary: probeResult?.summary,
    probeResults: probeResult?.results.map((item) => ({
      modelName: item.modelName,
      probeId: item.probeId,
      status: item.status,
    })),
  });
}

async function savePlanResult(projectRoot: string, result: PlanRunResult): Promise<void> {
  const dir = path.join(projectRoot, ".aidrift", "results");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `plan_${fileTimestamp(new Date())}.json`),
    JSON.stringify(result, null, 2),
    "utf8",
  );
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
