import path from "node:path";

import { Command } from "commander";

import {
  ExitCode,
  validateManifestFile,
  type ManifestValidationIssue,
  type ResolvedAIDriftConfig,
  type WritableStreamLike,
} from "@aidrift/core";

export interface RegisterValidateCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
  readonly resolveConfig: () => ResolvedAIDriftConfig;
}

export function registerValidateCommand(
  program: Command,
  options: RegisterValidateCommandOptions,
): void {
  program
    .command("validate")
    .description("Validate the .aistate.yml manifest file.")
    .option("--strict", "Treat validation warnings as failures")
    .action(async (commandOptions: { readonly strict?: boolean }) => {
      const config = options.resolveConfig();
      const manifestPath = config.configPath ?? path.resolve(process.cwd(), ".aistate.yml");
      const result = await validateManifestFile({
        manifestPath,
        strict: commandOptions.strict === true,
      });

      if (!result.valid) {
        options.io.stderr.write(formatIssues("Errors", result.errors));
        process.exitCode = ExitCode.Failure;
        return;
      }

      if (result.warnings.length > 0) {
        options.io.stderr.write(formatIssues("Warnings", result.warnings));
      }

      if (config.logLevel !== "error") {
        options.io.stdout.write(`Manifest is valid: ${manifestPath}\n`);
      }
    });
}

function formatIssues(title: string, issues: readonly ManifestValidationIssue[]): string {
  if (issues.length === 0) {
    return "";
  }

  const lines = issues.map((issue) => {
    const location = formatIssueLocation(issue);
    const fix = issue.fix === undefined ? "" : `\n  Fix: ${issue.fix}`;
    return `- [${issue.code}]${location} ${issue.message}${fix}`;
  });

  return `${title}:\n${lines.join("\n")}\n`;
}

function formatIssueLocation(issue: ManifestValidationIssue): string {
  const pathSegment = issue.manifestPath === undefined ? "" : ` ${issue.manifestPath}`;
  const lineSegment = issue.line === undefined ? "" : `:${issue.line}`;
  return `${pathSegment}${lineSegment}`;
}
