import path from "node:path";

import { Command } from "commander";

import {
  AIDriftError,
  assertManifestRuntimeSupported,
  ExitCode,
  listSnapshots,
  type ManifestValidationIssue,
  type SnapshotSummary,
  validateManifestFile,
  type WritableStreamLike,
} from "@zettacore/aidrift-core";

import { resolveCommandFormat, resolveCommandManifestPath } from "../config/command-config.js";

export interface RegisterHistoryCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

export function registerHistoryCommand(
  program: Command,
  options: RegisterHistoryCommandOptions,
): void {
  program
    .command("history")
    .description("List past snapshots in reverse chronological order.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--limit <n>", "Maximum number of snapshots to show", "20")
    .option("--since <date>", "Show snapshots at or after an ISO-8601 date")
    .option("--until <date>", "Show snapshots at or before an ISO-8601 date")
    .option("--show-changes", "Include changed artifact details")
    .option("--labels-only", "Show only labeled snapshots")
    .option("--format <fmt>", "Output format: text, json")
    .action(
      async (
        commandOptions: {
          readonly config?: string;
          readonly limit?: string;
          readonly since?: string;
          readonly until?: string;
          readonly showChanges?: boolean;
          readonly labelsOnly?: boolean;
          readonly format?: string;
        },
        cmd: Command,
      ) => {
        const merged = cmd.optsWithGlobals<{
          config?: string;
          limit?: string;
          since?: string;
          until?: string;
          showChanges?: boolean;
          labelsOnly?: boolean;
          format?: string;
        }>();
        const manifestPath = resolveCommandManifestPath(merged.config, options.env);
        const projectRoot = path.dirname(manifestPath);
        const limit = parseLimit(merged.limit);
        const format = parseHistoryFormat(resolveCommandFormat(merged.format, options.env));
        const since = parseHistoryDate(merged.since, "--since");
        const until = parseHistoryDate(merged.until, "--until");
        if (since !== undefined && until !== undefined && since > until) {
          throw historyOptionError("--since must be earlier than or equal to --until.");
        }

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
        assertManifestRuntimeSupported(validation.manifest, "history");

        const allSnapshots = await listSnapshots(projectRoot, validation.manifest.storage.path);
        const snapshots = allSnapshots
          .filter((snapshot) => since === undefined || Date.parse(snapshot.timestamp) >= since)
          .filter((snapshot) => until === undefined || Date.parse(snapshot.timestamp) <= until)
          .filter((snapshot) => merged.labelsOnly !== true || snapshot.label !== undefined)
          .slice(0, limit);

        if (format === "json") {
          const output =
            merged.showChanges === true ? snapshots : snapshots.map(historySummaryWithoutChanges);
          options.io.stdout.write(JSON.stringify(output, null, 2) + "\n");
          return;
        }

        if (snapshots.length === 0) {
          options.io.stdout.write("No snapshots found. Run 'aidrift snapshot' to create one.\n");
          return;
        }

        const lines = snapshots.map((s) => {
          const label = s.label !== undefined ? ` [${s.label}]` : "";
          const commit = s.gitCommit !== undefined ? ` (${s.gitCommit})` : "";
          const branch = s.gitBranch !== undefined ? ` on ${s.gitBranch}` : "";
          const summary = `${s.id}${label}  ${s.timestamp}  changed: ${s.changedArtifactCount}  artifacts: ${s.artifactCount}${commit}${branch}`;
          if (merged.showChanges !== true) {
            return summary;
          }
          const keys =
            s.changes.artifactKeys.length === 0 ? "none" : s.changes.artifactKeys.join(", ");
          return `${summary}\n  changes: +${s.changes.added} ~${s.changes.modified} -${s.changes.removed} (${keys})`;
        });

        options.io.stdout.write(lines.join("\n") + "\n");
      },
    );
}

function parseLimit(value: string | undefined): number {
  const raw = value ?? "20";
  if (!/^\d+$/u.test(raw)) {
    throw historyOptionError("--limit must be a positive integer.");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw historyOptionError("--limit must be a positive integer.");
  }
  return parsed;
}

function parseHistoryFormat(value: string | undefined): "text" | "json" {
  const format = (value ?? "text").trim().toLowerCase();
  if (format === "text" || format === "json") {
    return format;
  }
  throw historyOptionError("--format must be text or json.");
}

function parseHistoryDate(value: string | undefined, option: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(value)) {
    throw historyOptionError(`${option} must be a valid ISO-8601 date.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw historyOptionError(`${option} must be a valid ISO-8601 date.`);
  }
  return option === "--until" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? timestamp + 24 * 60 * 60 * 1000 - 1
    : timestamp;
}

function historyOptionError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "history.option.invalid",
    exitCode: ExitCode.ConfigError,
    what: "Invalid snapshot history option.",
    why: reason,
    fix: "Review 'aidrift history --help' and provide a supported value.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function historySummaryWithoutChanges(snapshot: SnapshotSummary): Omit<SnapshotSummary, "changes"> {
  return {
    id: snapshot.id,
    label: snapshot.label,
    timestamp: snapshot.timestamp,
    artifactCount: snapshot.artifactCount,
    changedArtifactCount: snapshot.changedArtifactCount,
    gitCommit: snapshot.gitCommit,
    gitBranch: snapshot.gitBranch,
  };
}

function manifestValidationError(
  errors: readonly ManifestValidationIssue[],
  manifestPath: string,
): AIDriftError {
  const first = errors[0];
  return new AIDriftError({
    code: first?.code ?? "manifest.invalid",
    exitCode: ExitCode.ConfigError,
    what: `Cannot read snapshot history for manifest: ${manifestPath}`,
    why: errors.length === 0 ? "Manifest validation failed." : errors.map(formatIssue).join("; "),
    fix: first?.fix ?? "Fix .aistate.yml and run aidrift history again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function formatIssue(issue: ManifestValidationIssue): string {
  const location = issue.line === undefined ? "" : ` at line ${issue.line}`;
  return `[${issue.code}]${location} ${issue.message}`;
}
