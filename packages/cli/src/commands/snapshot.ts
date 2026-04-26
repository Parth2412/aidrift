import path from "node:path";

import { Command } from "commander";

import {
  captureSnapshot,
  ExitCode,
  validateManifestFile,
  writeSnapshot,
  type WritableStreamLike,
} from "@aidrift/core";

import { CLI_VERSION } from "../program.js";

export interface RegisterSnapshotCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
}

export function registerSnapshotCommand(
  program: Command,
  options: RegisterSnapshotCommandOptions,
): void {
  program
    .command("snapshot")
    .description("Capture a point-in-time snapshot of AI system state.")
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("--label <label>", "Human-readable label for this snapshot")
    .option("--message <message>", "Description for this snapshot")
    .action(
      async (
        commandOptions: {
          readonly config?: string;
          readonly label?: string;
          readonly message?: string;
        },
        cmd: Command,
      ) => {
        // optsWithGlobals merges root-program opts (where -c is consumed) with
        // subcommand opts, so --config works regardless of position.
        const merged = cmd.optsWithGlobals<{ config?: string; label?: string; message?: string }>();
        const manifestPath =
          merged.config ?? path.resolve(process.cwd(), ".aistate.yml");
        const projectRoot = path.dirname(manifestPath);

        const validation = await validateManifestFile({ manifestPath });
        // Filter out path-resolution errors so snapshot works even when eval
        // suite or optional paths don't exist yet; capture will fail if
        // artifact paths are missing.
        const schemaErrors = validation.errors.filter(
          (e) => e.code !== "manifest.path.missing",
        );
        if (schemaErrors.length > 0 || validation.manifest === undefined) {
          options.io.stderr.write(
            `Manifest validation failed: ${manifestPath}\n` +
              schemaErrors.map((e) => `  - ${e.message}`).join("\n") +
              "\n",
          );
          process.exitCode = ExitCode.Failure;
          return;
        }

        const snapshot = await captureSnapshot({
          manifest: validation.manifest,
          manifestPath,
          projectRoot,
          cliVersion: CLI_VERSION,
          label: merged.label,
          message: merged.message,
        });

        await writeSnapshot(projectRoot, snapshot);

        const artifactCount = Object.keys(snapshot.artifacts).length;
        options.io.stdout.write(
          `Snapshot created: ${snapshot.id}\n` +
            `  Artifacts: ${artifactCount}\n` +
            `  Timestamp: ${snapshot.timestamp}\n` +
            (snapshot.label !== undefined ? `  Label: ${snapshot.label}\n` : "") +
            (snapshot.metadata.gitCommit !== undefined
              ? `  Git commit: ${snapshot.metadata.gitCommit}\n`
              : ""),
        );
      },
    );
}
