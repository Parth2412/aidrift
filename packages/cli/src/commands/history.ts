import path from "node:path";

import { Command } from "commander";

import { listSnapshots, type WritableStreamLike } from "@aidrift/core";

export interface RegisterHistoryCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
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
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(
      async (
        commandOptions: {
          readonly config?: string;
          readonly limit?: string;
          readonly format?: string;
        },
        cmd: Command,
      ) => {
        const merged = cmd.optsWithGlobals<{ config?: string; limit?: string; format?: string }>();
        const manifestPath =
          merged.config ?? path.resolve(process.cwd(), ".aistate.yml");
        const projectRoot = path.dirname(manifestPath);
        const limit = Number(merged.limit ?? "20");
        const format = merged.format ?? "text";

        const allSnapshots = await listSnapshots(projectRoot);
        const snapshots = allSnapshots.slice(0, limit);

        if (format === "json") {
          options.io.stdout.write(JSON.stringify(snapshots, null, 2) + "\n");
          return;
        }

        if (snapshots.length === 0) {
          options.io.stdout.write(
            "No snapshots found. Run 'aidrift snapshot' to create one.\n",
          );
          return;
        }

        const lines = snapshots.map((s) => {
          const label = s.label !== undefined ? ` [${s.label}]` : "";
          const commit = s.gitCommit !== undefined ? ` (${s.gitCommit})` : "";
          const branch = s.gitBranch !== undefined ? ` on ${s.gitBranch}` : "";
          return `${s.id}${label}  ${s.timestamp}  artifacts: ${s.artifactCount}${commit}${branch}`;
        });

        options.io.stdout.write(lines.join("\n") + "\n");
      },
    );
}
