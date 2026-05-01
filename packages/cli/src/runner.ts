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
    return consumeProcessExitCode();
  } catch (error) {
    return handleCliError(error, options);
  }
}

function findUnknownCommand(args: readonly string[]): string | undefined {
  const optionsWithValues = new Set([
    "-c",
    "--config",
    "-f",
    "--format",
    "--template",
    "--dir",
    "--label",
    "--message",
    "--limit",
    "--assertions",
    "--tags",
    "--samples",
    "--allow-regression",
    "--budget",
    "--timeout",
    "--concurrency",
  ]);
  const knownCommands = new Set(["validate", "init", "snapshot", "history", "diff", "plan"]);

  let seenCommand = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (optionsWithValues.has(arg)) {
      index += 1;
      continue;
    }

    if (
      arg.startsWith("--config=") ||
      arg.startsWith("--format=") ||
      arg.startsWith("--template=") ||
      arg.startsWith("--dir=") ||
      arg.startsWith("--label=") ||
      arg.startsWith("--message=") ||
      arg.startsWith("--limit=") ||
      arg.startsWith("--assertions=") ||
      arg.startsWith("--tags=") ||
      arg.startsWith("--samples=") ||
      arg.startsWith("--allow-regression=") ||
      arg.startsWith("--budget=") ||
      arg.startsWith("--timeout=") ||
      arg.startsWith("--concurrency=")
    ) {
      continue;
    }

    if (arg.startsWith("-")) {
      continue;
    }

    // Once a known command has been seen, subsequent non-flag arguments are
    // positional args for that subcommand, not new commands.
    if (seenCommand) {
      continue;
    }

    if (knownCommands.has(arg)) {
      seenCommand = true;
      continue;
    }

    return arg;
  }

  return undefined;
}

function consumeProcessExitCode(): ExitCode {
  const exitCode = process.exitCode;
  process.exitCode = undefined;

  if (exitCode === ExitCode.Failure || exitCode === ExitCode.ConfigError) {
    return exitCode;
  }

  return ExitCode.Success;
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
