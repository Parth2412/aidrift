import { Command } from "commander";

import type { AIDriftEnv, PartialAIDriftConfig, WritableStreamLike } from "@aidrift/core";
import { resolveAIDriftConfig } from "@aidrift/core";

import { globalOptionsToConfig, type GlobalCliOptions } from "./config/cli-options.js";

export const CLI_NAME = "aidrift";
export const CLI_VERSION = "0.0.0";

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
    .option("-f, --format <fmt>", "Output format: text, json, yaml", "text")
    .action(() => {
      const config = resolveConfigFromProgram(program, options);
      const colorStatus = config.color ? "enabled" : "disabled";

      options.io.stdout.write(`AIDRIFT ${version}

Terraform for AI behavior.

Bootstrap status:
  CLI foundation initialized.
  Output format: ${config.format}
  Log level: ${config.logLevel}
  Color: ${colorStatus}

Product commands are implemented in later phases.
`);
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
