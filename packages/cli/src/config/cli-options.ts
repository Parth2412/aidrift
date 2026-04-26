import type { PartialAIDriftConfig } from "@aidrift/core";

export interface GlobalCliOptions {
  readonly config?: string | undefined;
  readonly format?: string | undefined;
  readonly verbose?: boolean | undefined;
  readonly debug?: boolean | undefined;
  readonly quiet?: boolean | undefined;
  readonly color?: boolean | undefined;
}

export function globalOptionsToConfig(options: GlobalCliOptions): PartialAIDriftConfig {
  return {
    configPath: options.config,
    format: options.format,
    verbose: options.verbose,
    debug: options.debug,
    quiet: options.quiet,
    color: options.color,
    noColor: options.color === false,
  };
}
