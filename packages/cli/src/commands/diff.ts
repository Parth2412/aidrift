import path from "node:path";

import { Command } from "commander";

import {
  diffSnapshots,
  ExitCode,
  listSnapshots,
  readSnapshot,
  type SnapshotDiffResult,
  type WritableStreamLike,
} from "@aidrift/core";

export interface RegisterDiffCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
}

function formatTextDiff(result: SnapshotDiffResult): string {
  if (result.changedCount === 0) {
    return `No changes between ${result.snapshotIdA} and ${result.snapshotIdB}.\n`;
  }

  const lines: string[] = [
    `Diff: ${result.snapshotIdA} → ${result.snapshotIdB}`,
    `  Changed: ${result.changedCount} | Added: ${result.addedCount} | Removed: ${result.removedCount} | Unchanged: ${result.unchangedCount}`,
    "",
  ];

  for (const artifact of result.artifacts) {
    if (artifact.status === "unchanged") {
      continue;
    }

    const statusLabel =
      artifact.status === "added"
        ? "+ added"
        : artifact.status === "removed"
          ? "- removed"
          : "~ modified";

    lines.push(`${statusLabel}  ${artifact.artifactKey}`);

    if (artifact.textDiff !== undefined) {
      lines.push(artifact.textDiff);
    }

    if (artifact.paramDiff !== undefined && artifact.paramDiff.length > 0) {
      for (const param of artifact.paramDiff) {
        if (param.status === "modified") {
          lines.push(`  ${param.param}: ${String(param.valueA)} → ${String(param.valueB)}`);
        } else if (param.status === "added") {
          lines.push(`  + ${param.param}: ${String(param.valueB)}`);
        } else if (param.status === "removed") {
          lines.push(`  - ${param.param}: ${String(param.valueA)}`);
        }
      }
    }

    if (artifact.kind === "binary") {
      lines.push(`  hash: ${artifact.hashA ?? "—"} → ${artifact.hashB ?? "—"}`);
    }
  }

  return lines.join("\n") + "\n";
}

export function registerDiffCommand(
  program: Command,
  options: RegisterDiffCommandOptions,
): void {
  program
    .command("diff [snap_a] [snap_b]")
    .description(
      "Diff two snapshots. Defaults to latest vs second-latest. Pass one ID to diff against current.",
    )
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--format <fmt>", "Output format: text, json", "text")
    .option("--stat", "Show summary statistics only")
    .action(
      async (
        snapAArg: string | undefined,
        snapBArg: string | undefined,
        commandOptions: {
          readonly config?: string;
          readonly format?: string;
          readonly stat?: boolean;
        },
        cmd: Command,
      ) => {
        const merged = cmd.optsWithGlobals<{ config?: string; format?: string; stat?: boolean }>();
        const manifestPath =
          merged.config ?? path.resolve(process.cwd(), ".aistate.yml");
        const projectRoot = path.dirname(manifestPath);
        const format = merged.format ?? "text";

        const allSummaries = await listSnapshots(projectRoot);

        // Resolve snapshot IDs
        let idA: string;
        let idB: string;

        if (snapAArg !== undefined && snapBArg !== undefined) {
          idA = snapAArg;
          idB = snapBArg;
        } else if (snapAArg !== undefined) {
          // diff snapAArg against latest
          if (allSummaries.length === 0) {
            options.io.stderr.write(
              "Error: No snapshots found. Run 'aidrift snapshot' first.\n",
            );
            process.exitCode = ExitCode.Failure;
            return;
          }
          idA = snapAArg;
          idB = allSummaries[0]!.id;
        } else {
          // default: latest vs second-latest
          if (allSummaries.length < 2) {
            options.io.stderr.write(
              "Error: Need at least 2 snapshots for default diff.\n" +
                "  Fix: Provide explicit snapshot IDs: aidrift diff <snap_a> <snap_b>\n",
            );
            process.exitCode = ExitCode.Failure;
            return;
          }
          idA = allSummaries[1]!.id;
          idB = allSummaries[0]!.id;
        }

        const [snapA, snapB] = await Promise.all([
          readSnapshot(projectRoot, idA),
          readSnapshot(projectRoot, idB),
        ]);

        const diffResult = diffSnapshots(snapA, snapB);

        if (format === "json") {
          options.io.stdout.write(JSON.stringify(diffResult, null, 2) + "\n");
          return;
        }

        if (merged.stat === true) {
          options.io.stdout.write(
            `Changed: ${diffResult.changedCount} | Added: ${diffResult.addedCount} | Removed: ${diffResult.removedCount} | Unchanged: ${diffResult.unchangedCount}\n`,
          );
          return;
        }

        options.io.stdout.write(formatTextDiff(diffResult));
      },
    );
}
