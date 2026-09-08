import { CommanderError } from "commander";

import {
  AIDriftError,
  ExitCode,
  formatAIDriftError,
  redactSecrets,
  type AIDriftEnv,
} from "@zettacore/aidrift-core";

import { createCliProgram, type CliProgramIO } from "./program.js";

export interface RunCliOptions extends CliProgramIO {
  readonly env?: AIDriftEnv | undefined;
}

export async function runCli(argv: readonly string[], options: RunCliOptions): Promise<ExitCode> {
  const argumentsOnly = argv.slice(2);
  const quiet =
    (argumentsOnly.includes("--quiet") || argumentsOnly.includes("-q")) &&
    !argumentsOnly.some((argument) => ["--help", "-h", "--version", "-V"].includes(argument));
  const program = createCliProgram({
    io: {
      stdout: quiet ? { write: () => undefined } : options.stdout,
      stderr: options.stderr,
    },
    env: options.env,
  });

  try {
    const rootOperand = program.parseOptions([...argv.slice(2)]).operands[0];
    if (
      rootOperand !== undefined &&
      !program.commands.some(
        (command) => command.name() === rootOperand || command.aliases().includes(rootOperand),
      )
    ) {
      options.stderr.write(redactSecrets(`error: unknown command '${rootOperand}'\n`));
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
    options.stderr.write(redactSecrets(formatAIDriftError(error)));
    return error.exitCode;
  }

  options.stderr.write(
    redactSecrets(`Error: Unexpected AIDRIFT failure.
  Code: unexpected_error
  Reason: An unexpected internal error occurred.
  Fix: Re-run the command and report the reproducible command if the failure persists.
  Docs: https://github.com/Parth2412/aidrift#readme
`),
  );
  return ExitCode.ConfigError;
}
