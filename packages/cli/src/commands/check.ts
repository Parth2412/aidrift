import fs from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import {
  AIDriftError,
  ExitCode,
  listSnapshots,
  redactSecrets,
  readSnapshot,
  runEvalPlan,
  runProviderProbes,
  type AIStateManifest,
  validateManifestFile,
  type AssertionEvalResult,
  type ManifestValidationIssue,
  type PlanRunResult,
  type PlanRunSummary,
  type EvalProvider,
  type ProbeModelTarget,
  type ProbeResult,
  type ProbeRunResult,
  type ProbeRunSummary,
  type SnapshotSummary,
  type WritableStreamLike,
} from "@aidrift/core";

import { buildLiveProvider, checkProviderEnvVar, type LiveProviderId } from "../provider-gate.js";

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
}

type CheckFormat = "text" | "json" | "junit" | "github";
type FailOn = "fail" | "warn";

interface CheckRunResult {
  readonly evals: PlanRunResult;
  readonly probes: ProbeRunResult;
  readonly baselineSnapshotId: string;
  readonly passed: boolean;
  readonly failOn: FailOn;
}

export function registerCheckCommand(program: Command, options: RegisterCheckCommandOptions): void {
  program
    .command("check")
    .description("CI/CD quality gate: run evals against latest baseline, exit 1 on regression.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--format <fmt>", "Output format: text, json, junit, or github", "text")
    .option("--baseline <sha-or-tag>", "Snapshot id, label, tag, or git SHA to use as baseline")
    .option("--output <path>", "Also write formatted output to this file")
    .option("--fail-on <level>", "Failure threshold: fail (default) or warn", "fail")
    .option("--assertions <ids>", "Run only specific assertion IDs (comma-separated)")
    .option("--tags <tags>", "Run only assertions matching tags (comma-separated)")
    .action(async (commandOptions: CheckCommandOptions, cmd: Command) => {
      const merged = cmd.optsWithGlobals<CheckCommandOptions>();
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

      const format = parseFormat(merged.format);
      const failOn = parseFailOn(merged.failOn);
      const baselineSnapshotId = await resolveBaseline(projectRoot, merged.baseline);
      const models = manifestModels(validation.manifest);
      const provider = resolveCheckProvider(models, options.env ?? process.env);

      const suitePath = path.resolve(projectRoot, validation.manifest.eval.suite);
      const evals = await runEvalPlan({
        projectRoot,
        suitePath,
        concurrency: 4,
        assertionIds: parseCsvSet(merged.assertions),
        tags: parseCsvSet(merged.tags),
        baselineSnapshotId,
        provider,
      });
      const probes = await runProviderProbes({
        projectRoot,
        models,
        samples: 1,
        cacheTtlMinutes: 0,
        useCache: false,
        concurrency: 4,
        baselineSnapshotId,
        provider,
      });

      const passed = computePassed(evals.summary, probes.summary, failOn);
      if (probes.summary.errors > 0) {
        throw new AIDriftError({
          code: "check.probe.runtime_error",
          exitCode: ExitCode.ConfigError,
          what: "Provider probe execution failed.",
          why: `${probes.summary.errors} probe${probes.summary.errors === 1 ? "" : "s"} returned an execution error.`,
          fix: "Fix the provider or manifest configuration, then re-run aidrift check.",
          docs: "../aidrift-docs/PHASES/11-github-workflow-integration.md",
        });
      }
      const result: CheckRunResult = {
        evals,
        probes,
        baselineSnapshotId,
        passed,
        failOn,
      };
      const formatted = renderOutput(result, format, manifestPath);
      const safe = redactSecrets(formatted);

      options.io.stdout.write(safe);

      if (merged.output !== undefined) {
        const outputPath = path.resolve(merged.output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, safe, "utf8");
      }

      if (!passed) {
        process.exitCode = ExitCode.Failure;
      }
    });
}

async function resolveBaseline(
  projectRoot: string,
  baselineArg: string | undefined,
): Promise<string> {
  const snapshots = await listSnapshots(projectRoot);
  if (baselineArg !== undefined) {
    const found = await findSnapshotBaseline(projectRoot, snapshots, baselineArg);
    if (found !== undefined) {
      return found;
    }
    throw new AIDriftError({
      code: "check.baseline.not_found",
      exitCode: ExitCode.ConfigError,
      what: `Baseline not found: ${baselineArg}`,
      why: "No snapshot id, label, tag, or git commit matched the requested baseline.",
      fix: "Run 'aidrift history' to list snapshots, then pass a valid --baseline value.",
      docs: "../aidrift-docs/PHASES/11-github-workflow-integration.md",
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
      docs: "../aidrift-docs/PHASES/11-github-workflow-integration.md",
    });
  }

  return latest.id;
}

async function findSnapshotBaseline(
  projectRoot: string,
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

    const snapshot = await readSnapshot(projectRoot, summary.id);
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
    return evalSummary.failed === 0 && evalSummary.warned === 0 && probeSummary.drifted === 0;
  }
  return evalSummary.failed === 0 && probeSummary.drifted === 0;
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
    docs: "../aidrift-docs/PHASES/11-github-workflow-integration.md",
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
    docs: "../aidrift-docs/PHASES/11-github-workflow-integration.md",
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
    docs: "../aidrift-docs/MANIFEST-SPEC.md",
  });
}

function resolveCheckProvider(
  models: readonly ProbeModelTarget[],
  env: Readonly<Record<string, string | undefined>>,
): EvalProvider | undefined {
  const liveProviders = new Set<LiveProviderId>();
  for (const model of models) {
    if (model.provider === "openai" || model.provider === "anthropic") {
      liveProviders.add(model.provider);
    }
  }

  if (liveProviders.size === 0) {
    return undefined;
  }

  if (liveProviders.size > 1) {
    throw new AIDriftError({
      code: "check.provider.mixed",
      exitCode: ExitCode.ConfigError,
      what: "Multiple live providers found in manifest model artifacts.",
      why: "aidrift check uses one live provider per run for evals and probes.",
      fix: "Use one provider family per check run or split the manifest.",
      docs: "../aidrift-docs/MANIFEST-SPEC.md",
    });
  }

  const providerId = [...liveProviders][0] as LiveProviderId;
  checkProviderEnvVar(providerId, env);
  return buildLiveProvider(providerId, models, env);
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
    docs: "../aidrift-docs/MANIFEST-SPEC.md",
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
    `Assertions: ${result.evals.summary.total}`,
    `Probes: ${result.probes.summary.total}`,
    "",
  ];

  for (const item of result.evals.results) {
    const baseline =
      item.baselineScore === undefined
        ? "new"
        : `${item.baselineScore.toFixed(2)} -> ${item.score.toFixed(2)}`;
    lines.push(`${item.assertionId}\t${item.status}\t${baseline}\t${item.explanation}`);
  }

  if (result.probes.results.length > 0) {
    lines.push("");
    for (const item of result.probes.results) {
      const baseline =
        item.baselineScore === undefined
          ? "new"
          : `${item.baselineScore.toFixed(2)} -> ${item.score.toFixed(2)}`;
      lines.push(
        `${item.modelName}/${item.probeId}\t${item.status}\t${baseline}\t${item.explanation}`,
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
    `Summary: ${result.evals.summary.passed} PASS, ${result.evals.summary.warned} WARN, ${result.evals.summary.failed} FAIL, ${result.evals.summary.new} NEW; probes ${result.probes.summary.passed} PASS, ${result.probes.summary.drifted} DRIFT, ${result.probes.summary.errors} ERROR, ${result.probes.summary.new} NEW${regressionNote}`,
    result.passed ? "Result: PASS" : "Result: FAIL",
  );

  return `${lines.join("\n")}\n`;
}

function renderJson(result: CheckRunResult): string {
  const output = {
    schemaVersion: "1",
    passed: result.passed,
    failOn: result.failOn,
    baselineSnapshotId: result.baselineSnapshotId,
    startedAt: minIso(result.evals.startedAt, result.probes.startedAt),
    completedAt: maxIso(result.evals.completedAt, result.probes.completedAt),
    durationMs: result.evals.durationMs + result.probes.durationMs,
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
        readonly explanation: string;
        readonly critical: boolean;
        readonly tags: readonly string[];
      } => ({
        assertionId: item.assertionId,
        type: item.type,
        status: item.status,
        score: item.score,
        ...(item.baselineScore !== undefined ? { baselineScore: item.baselineScore } : {}),
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
          readonly confidence: number;
          readonly explanation: string;
        } => ({
          modelName: item.modelName,
          provider: item.provider,
          model: item.model,
          probeId: item.probeId,
          category: item.category,
          status: item.status,
          score: item.score,
          ...(item.baselineScore !== undefined ? { baselineScore: item.baselineScore } : {}),
          confidence: item.confidence,
          explanation: item.explanation,
        }),
      ),
    },
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}

function renderJunit(result: CheckRunResult): string {
  const totalMs = result.evals.durationMs + result.probes.durationMs;
  const totalSec = (totalMs / 1000).toFixed(3);
  const failures =
    result.evals.summary.failed +
    (result.failOn === "warn" ? result.evals.summary.warned : 0) +
    result.probes.summary.drifted +
    result.probes.summary.errors;
  const total = result.evals.summary.total + result.probes.summary.total;
  const timestamp = minIso(result.evals.startedAt, result.probes.startedAt);

  const testcases = [
    ...result.evals.results.map((item) => renderJunitEvalTestcase(item, result.failOn)),
    ...result.probes.results.map((item) => renderJunitProbeTestcase(item)),
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

function renderJunitProbeTestcase(item: ProbeResult): string {
  const sampleLatency = item.samples.reduce((total, sample) => total + sample.latencyMs, 0);
  const timeSec = (sampleLatency / 1000).toFixed(3);
  const name = `${item.modelName}/${item.probeId}`;
  const open = `    <testcase name="${xmlEscape(name)}" classname="aidrift.check" time="${timeSec}">`;
  const empty = `    <testcase name="${xmlEscape(name)}" classname="aidrift.check" time="${timeSec}" />`;
  const close = `    </testcase>`;

  if (item.status === "PASS" || item.status === "NEW") {
    return empty;
  }

  const baselineScore = item.baselineScore ?? 0;
  const failType = "drift";
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
    }
  }

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function formatGithubAnnotation(level: "warning" | "error", file: string, message: string): string {
  return `::${level} file=${escapeGithubProperty(file)},line=1::${escapeGithubData(message)}`;
}

function escapeGithubProperty(value: string): string {
  return escapeGithubData(value).replace(/:/gu, "%3A").replace(/,/gu, "%2C");
}

function escapeGithubData(value: string): string {
  return value.replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
}

function minIso(left: string, right: string): string {
  return left <= right ? left : right;
}

function maxIso(left: string, right: string): string {
  return left >= right ? left : right;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
