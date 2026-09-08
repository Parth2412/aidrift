import path from "node:path";

import { Command } from "commander";

import {
  AIDriftError,
  assertManifestRuntimeSupported,
  captureSnapshot,
  diffSnapshots,
  ExitCode,
  listSnapshots,
  readSnapshot,
  type ArtifactDiffResult,
  type ManifestValidationIssue,
  type Snapshot,
  type SnapshotDiffResult,
  validateManifestFile,
  type WritableStreamLike,
} from "@zettacore/aidrift-core";

import { CLI_VERSION } from "../program.js";
import { resolveCommandFormat, resolveCommandManifestPath } from "../config/command-config.js";

export interface RegisterDiffCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

interface DiffCommandOptions {
  readonly config?: string;
  readonly format?: string;
  readonly stat?: boolean;
  readonly artifact?: string;
}

type DiffFormat = "text" | "json" | "markdown";

interface ArtifactGroupStats {
  readonly total: number;
  readonly changed: number;
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  readonly unchanged: number;
}

export function registerDiffCommand(program: Command, options: RegisterDiffCommandOptions): void {
  program
    .command("diff [snap_a] [snap_b]")
    .description("Diff latest/specified baseline against current state, or compare two snapshots.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--format <fmt>", "Output format: text, json, markdown")
    .option("--stat", "Show summary statistics only")
    .option("--artifact <name>", "Show a specific artifact or artifact prefix")
    .action(
      async (
        snapAArg: string | undefined,
        snapBArg: string | undefined,
        commandOptions: DiffCommandOptions,
        cmd: Command,
      ) => {
        const merged = cmd.optsWithGlobals<DiffCommandOptions>();
        const manifestPath = resolveCommandManifestPath(merged.config, options.env);
        const projectRoot = path.dirname(manifestPath);
        const format = parseDiffFormat(resolveCommandFormat(merged.format, options.env));

        const validation = await validateManifestFile({ manifestPath });
        if (validation.manifest === undefined) {
          throw manifestValidationError(validation.errors, manifestPath);
        }
        const blockingErrors = validation.errors.filter(
          (issue) =>
            !(issue.code === "manifest.path.missing" && issue.manifestPath === "eval.suite"),
        );
        if (blockingErrors.length > 0) {
          throw manifestValidationError(blockingErrors, manifestPath);
        }
        assertManifestRuntimeSupported(validation.manifest, "diff", {
          captureCurrentState: snapBArg === undefined,
        });

        const storagePath = validation.manifest.storage.path;
        const allSummaries = await listSnapshots(projectRoot, storagePath);
        let snapshotA: Snapshot;
        let snapshotB: Snapshot;

        if (snapAArg !== undefined && snapBArg !== undefined) {
          [snapshotA, snapshotB] = await Promise.all([
            readSnapshot(projectRoot, snapAArg, storagePath),
            readSnapshot(projectRoot, snapBArg, storagePath),
          ]);
        } else {
          const baselineId = snapAArg ?? allSummaries[0]?.id;
          if (baselineId === undefined) {
            throw new AIDriftError({
              code: "diff.baseline.missing",
              exitCode: ExitCode.ConfigError,
              what: "No snapshot found to use as a diff baseline.",
              why: "Current-state diff requires an existing baseline snapshot.",
              fix: "Run 'aidrift snapshot' and then run 'aidrift diff' again.",
              docs: "https://github.com/Parth2412/aidrift#readme",
            });
          }
          snapshotA = await readSnapshot(projectRoot, baselineId, storagePath);
          const captured = await captureSnapshot({
            manifest: validation.manifest,
            manifestPath,
            projectRoot,
            cliVersion: CLI_VERSION,
          });
          snapshotB = { ...captured, id: "current" };
        }

        const completeResult = diffSnapshots(snapshotA, snapshotB);
        const diffResult = filterArtifactDiff(completeResult, merged.artifact);

        if (merged.stat === true) {
          options.io.stdout.write(formatStats(diffResult, format));
        } else if (format === "json") {
          options.io.stdout.write(`${JSON.stringify(diffResult, null, 2)}\n`);
        } else if (format === "markdown") {
          options.io.stdout.write(formatMarkdownDiff(diffResult));
        } else {
          options.io.stdout.write(formatTextDiff(diffResult));
        }
      },
    );
}

function parseDiffFormat(value: string | undefined): DiffFormat {
  const format = (value ?? "text").trim().toLowerCase();
  if (format === "text" || format === "json" || format === "markdown") {
    return format;
  }
  throw new AIDriftError({
    code: "diff.format.unsupported",
    exitCode: ExitCode.ConfigError,
    what: `Unsupported diff output format: ${value ?? ""}`,
    why: "Only text, json, and markdown diff formats are supported.",
    fix: "Use --format text, --format json, or --format markdown.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function filterArtifactDiff(
  result: SnapshotDiffResult,
  selector: string | undefined,
): SnapshotDiffResult {
  if (selector === undefined) {
    return result;
  }
  const normalized = selector.trim().replace(/^\/+|\/+$/gu, "");
  const artifacts = result.artifacts.filter((artifact) => {
    const key = artifact.artifactKey;
    return (
      key === normalized ||
      key.startsWith(`${normalized}/`) ||
      key.endsWith(`/${normalized}`) ||
      key.includes(`/${normalized}/`)
    );
  });
  if (normalized.length === 0 || artifacts.length === 0) {
    throw new AIDriftError({
      code: "diff.artifact.not_found",
      exitCode: ExitCode.ConfigError,
      what: `No artifact matched: ${selector}`,
      why: "The selector did not match an exact artifact key, name, or collection prefix.",
      fix: "Use an artifact key shown by 'aidrift diff --format json'.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return summarizeDiff(result.snapshotIdA, result.snapshotIdB, artifacts);
}

function summarizeDiff(
  snapshotIdA: string,
  snapshotIdB: string,
  artifacts: readonly ArtifactDiffResult[],
): SnapshotDiffResult {
  const addedCount = artifacts.filter((artifact) => artifact.status === "added").length;
  const removedCount = artifacts.filter((artifact) => artifact.status === "removed").length;
  const changedCount = artifacts.filter((artifact) => artifact.status !== "unchanged").length;
  return {
    snapshotIdA,
    snapshotIdB,
    artifacts,
    changedCount,
    unchangedCount: artifacts.length - changedCount,
    addedCount,
    removedCount,
  };
}

function formatTextDiff(result: SnapshotDiffResult): string {
  if (result.changedCount === 0) {
    return `No changes between ${result.snapshotIdA} and ${result.snapshotIdB}.\n`;
  }
  const lines = [`Diff: ${result.snapshotIdA} → ${result.snapshotIdB}`, summaryLine(result), ""];
  for (const artifact of result.artifacts) {
    appendArtifactDetails(lines, artifact, "text");
  }
  return `${lines.join("\n")}\n`;
}

function formatMarkdownDiff(result: SnapshotDiffResult): string {
  const lines = [
    `## AIDRIFT Diff: \`${result.snapshotIdA}\` → \`${result.snapshotIdB}\``,
    "",
    `Changed: **${result.changedCount}** · Added: **${result.addedCount}** · Removed: **${result.removedCount}** · Unchanged: **${result.unchangedCount}**`,
    "",
  ];
  if (result.changedCount === 0) {
    lines.push("No artifact changes detected.", "");
    return lines.join("\n");
  }
  for (const artifact of result.artifacts) {
    appendArtifactDetails(lines, artifact, "markdown");
  }
  return `${lines.join("\n")}\n`;
}

function appendArtifactDetails(
  lines: string[],
  artifact: ArtifactDiffResult,
  format: "text" | "markdown",
): void {
  if (artifact.status === "unchanged") {
    return;
  }
  const marker = artifact.status === "added" ? "+" : artifact.status === "removed" ? "-" : "~";
  lines.push(
    format === "markdown"
      ? `### ${marker} \`${artifact.artifactKey}\` (${artifact.status})`
      : `${marker} ${artifact.status}  ${artifact.artifactKey}`,
  );

  if (artifact.textDiff !== undefined) {
    if (format === "markdown") {
      lines.push("", "```diff", artifact.textDiff.trimEnd(), "```", "");
    } else {
      lines.push(artifact.textDiff);
    }
  }
  if (artifact.jsonDiff !== undefined) {
    for (const entry of artifact.jsonDiff) {
      lines.push(
        `  ${entry.status} ${entry.key}: ${formatValue(entry.valueA)} → ${formatValue(entry.valueB)}`,
      );
    }
    if (format === "markdown") {
      lines.push("");
    }
  }
  if (artifact.paramDiff !== undefined) {
    for (const entry of artifact.paramDiff) {
      lines.push(
        `  ${entry.status} ${entry.param}: ${formatValue(entry.valueA)} → ${formatValue(entry.valueB)}`,
      );
    }
    if (format === "markdown") {
      lines.push("");
    }
  }
  if (artifact.kind === "binary") {
    lines.push(`  hash: ${artifact.hashA ?? "—"} → ${artifact.hashB ?? "—"}`);
    if (format === "markdown") {
      lines.push("");
    }
  }
}

function formatStats(result: SnapshotDiffResult, format: DiffFormat): string {
  const groups = groupStats(result.artifacts);
  const payload = {
    snapshotIdA: result.snapshotIdA,
    snapshotIdB: result.snapshotIdB,
    changedCount: result.changedCount,
    addedCount: result.addedCount,
    removedCount: result.removedCount,
    unchangedCount: result.unchangedCount,
    groups,
  };
  if (format === "json") {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  if (format === "markdown") {
    const lines = [
      `## AIDRIFT Diff Stats: \`${result.snapshotIdA}\` → \`${result.snapshotIdB}\``,
      "",
      "| Group | Changed | Added | Modified | Removed | Unchanged |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...Object.entries(groups).map(
        ([group, stats]) =>
          `| ${group} | ${stats.changed} | ${stats.added} | ${stats.modified} | ${stats.removed} | ${stats.unchanged} |`,
      ),
      "",
    ];
    return lines.join("\n");
  }
  const lines = [summaryLine(result)];
  for (const [group, stats] of Object.entries(groups)) {
    lines.push(
      `${group}: changed ${stats.changed} (+${stats.added} ~${stats.modified} -${stats.removed}), unchanged ${stats.unchanged}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function groupStats(artifacts: readonly ArtifactDiffResult[]): Record<string, ArtifactGroupStats> {
  const groups: Record<string, ArtifactGroupStats> = {};
  for (const artifact of artifacts) {
    const group = artifact.artifactKey.split("/", 1)[0] ?? "unknown";
    const current = groups[group] ?? {
      total: 0,
      changed: 0,
      added: 0,
      modified: 0,
      removed: 0,
      unchanged: 0,
    };
    groups[group] = {
      total: current.total + 1,
      changed: current.changed + (artifact.status === "unchanged" ? 0 : 1),
      added: current.added + (artifact.status === "added" ? 1 : 0),
      modified: current.modified + (artifact.status === "modified" ? 1 : 0),
      removed: current.removed + (artifact.status === "removed" ? 1 : 0),
      unchanged: current.unchanged + (artifact.status === "unchanged" ? 1 : 0),
    };
  }
  return Object.fromEntries(
    Object.entries(groups).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function summaryLine(result: SnapshotDiffResult): string {
  return `Changed: ${result.changedCount} | Added: ${result.addedCount} | Removed: ${result.removedCount} | Unchanged: ${result.unchangedCount}`;
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "—";
  }
  return typeof value === "string"
    ? JSON.stringify(value)
    : (JSON.stringify(value) ?? String(value));
}

function manifestValidationError(
  errors: readonly ManifestValidationIssue[],
  manifestPath: string,
): AIDriftError {
  const first = errors[0];
  return new AIDriftError({
    code: first?.code ?? "manifest.invalid",
    exitCode: ExitCode.ConfigError,
    what: `Cannot diff snapshots for manifest: ${manifestPath}`,
    why: errors.length === 0 ? "Manifest validation failed." : errors.map(formatIssue).join("; "),
    fix: first?.fix ?? "Fix .aistate.yml and run aidrift diff again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function formatIssue(issue: ManifestValidationIssue): string {
  const location = issue.line === undefined ? "" : ` at line ${issue.line}`;
  return `[${issue.code}]${location} ${issue.message}`;
}
