import { Command } from "commander";

import type { AIDriftEnv, PartialAIDriftConfig, WritableStreamLike } from "@zettacore/aidrift-core";
import { resolveAIDriftConfig } from "@zettacore/aidrift-core";

import { registerCheckCommand } from "./commands/check.js";
import { registerDiffCommand } from "./commands/diff.js";
import { registerHistoryCommand } from "./commands/history.js";
import { registerInitCommand } from "./commands/init.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerProbeCommand } from "./commands/probe.js";
import { registerSnapshotCommand } from "./commands/snapshot.js";
import { registerValidateCommand } from "./commands/validate.js";
import { globalOptionsToConfig, type GlobalCliOptions } from "./config/cli-options.js";

export const CLI_NAME = "aidrift";
export const CLI_VERSION = "0.9.0-beta.0";

export interface CliProgramIO {
  readonly stdout: WritableStreamLike;
  readonly stderr: WritableStreamLike;
}

export interface CreateCliProgramOptions {
  readonly io: CliProgramIO;
  readonly env?: AIDriftEnv | undefined;
  readonly manifestConfig?: PartialAIDriftConfig | undefined;
  readonly version?: string | undefined;
}

export function createCliProgram(options: CreateCliProgramOptions): Command {
  const version = options.version ?? CLI_VERSION;
  const program = new Command();

  program
    .name(CLI_NAME)
    .description("Version, diff, test, and gate AI system behavior.")
    .version(version, "-V, --version", "Print version")
    .helpOption("-h, --help", "Print help")
    .configureOutput({
      writeOut: (message) => options.io.stdout.write(message),
      writeErr: (message) => options.io.stderr.write(message),
    })
    .exitOverride()
    .showHelpAfterError()
    .option("-c, --config <path>", "Path to .aistate.yml")
    .option("-v, --verbose", "Verbose output")
    .option("--debug", "Debug output with secrets redacted")
    .option("-q, --quiet", "Suppress non-error output")
    .option("--no-color", "Disable colored output")
    .option("-f, --format <fmt>", "Output format (when supported by the command)")
    .action(() => {
      program.outputHelp();
    });

  registerCheckCommand(program, {
    io: options.io,
    env: options.env as unknown as Readonly<Record<string, string | undefined>> | undefined,
  });

  registerValidateCommand(program, {
    io: options.io,
    resolveConfig: () => resolveConfigFromProgram(program, options),
  });

  registerInitCommand(program, { io: options.io });
  registerSnapshotCommand(program, {
    io: options.io,
    env: options.env as unknown as Readonly<Record<string, string | undefined>> | undefined,
  });
  registerHistoryCommand(program, {
    io: options.io,
    env: options.env as unknown as Readonly<Record<string, string | undefined>> | undefined,
  });
  registerDiffCommand(program, {
    io: options.io,
    env: options.env as unknown as Readonly<Record<string, string | undefined>> | undefined,
  });
  registerPlanCommand(program, {
    io: options.io,
    env: options.env as unknown as Readonly<Record<string, string | undefined>> | undefined,
  });
  registerProbeCommand(program, {
    io: options.io,
    env: options.env as unknown as Readonly<Record<string, string | undefined>> | undefined,
  });

  return program;
}

export function resolveConfigFromProgram(
  program: Command,
  options: CreateCliProgramOptions,
): ReturnType<typeof resolveAIDriftConfig> {
  return resolveAIDriftConfig({
    cli: globalOptionsToConfig(program.opts<GlobalCliOptions>()),
    env: options.env,
    manifest: options.manifestConfig,
  });
}
