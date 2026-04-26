import { CommanderError } from "commander";

import { AIDriftError, ExitCode, formatAIDriftError, type AIDriftEnv } from "@aidrift/core";

import { createCliProgram, type CliProgramIO } from "./program.js";

export interface RunCliOptions extends CliProgramIO {
  readonly env?: AIDriftEnv | undefined;
}

export async function runCli(argv: readonly string[], options: RunCliOptions): Promise<ExitCode> {
  const program = createCliProgram({
    io: {
      stdout: options.stdout,
      stderr: options.stderr,
    },
    env: options.env,
  });

  try {
    const unknownCommand = findUnknownCommand(argv.slice(2));
    if (unknownCommand !== undefined) {
      options.stderr.write(`error: unknown command '${unknownCommand}'\n`);
      return ExitCode.ConfigError;
    }

    if (argv.length <= 2) {
      program.outputHelp();
      return ExitCode.Success;
    }

    await program.parseAsync([...argv], { from: "node" });
    return ExitCode.Success;
  } catch (error) {
    return handleCliError(error, options);
  }
}

function findUnknownCommand(args: readonly string[]): string | undefined {
  const optionsWithValues = new Set(["-c", "--config", "-f", "--format"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (optionsWithValues.has(arg)) {
      index += 1;
      continue;
    }

    if (arg.startsWith("--config=") || arg.startsWith("--format=")) {
      continue;
    }

    if (!arg.startsWith("-")) {
      return arg;
    }
  }

  return undefined;
}

function handleCliError(error: unknown, options: RunCliOptions): ExitCode {
  if (error instanceof CommanderError) {
    if (error.exitCode === ExitCode.Success) {
      return ExitCode.Success;
    }

    return ExitCode.ConfigError;
  }

  if (error instanceof AIDriftError) {
    options.stderr.write(formatAIDriftError(error));
    return error.exitCode;
  }

  options.stderr.write(`Error: Unexpected AIDRIFT failure.
  Code: unexpected_error
  Reason: An unexpected internal error occurred.
  Fix: Re-run with --debug and report the issue with the command you ran.
  Docs: ../aidrift-docs/SECURITY-GUIDELINES.md
`);
  return ExitCode.Failure;
}
