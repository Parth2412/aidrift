import { DEFAULT_AIDRIFT_CONFIG } from "./defaults.js";
import type {
  AIDriftConfigInput,
  AIDriftEnv,
  LogLevel,
  OutputFormat,
  PartialAIDriftConfig,
  ResolvedAIDriftConfig,
} from "./types.js";

const LOG_LEVELS = new Set<LogLevel>(["error", "warn", "info", "debug", "trace"]);
const OUTPUT_FORMATS = new Set<OutputFormat>([
  "text",
  "json",
  "yaml",
  "markdown",
  "junit",
  "github-annotations",
]);

export function resolveAIDriftConfig(input: AIDriftConfigInput = {}): ResolvedAIDriftConfig {
  const defaults = input.defaults ?? DEFAULT_AIDRIFT_CONFIG;
  const manifest = input.manifest ?? {};
  const env = envToConfig(input.env ?? {});
  const cli = input.cli ?? {};

  const resolved = mergeConfig(defaults, manifest, env, cli);

  return {
    configPath: resolved.configPath,
    format: normalizeOutputFormat(resolved.format, defaults.format),
    logLevel: resolveLogLevel({ defaults, manifest, env, cli }),
    color: resolveColor({ defaults, manifest, env, cli }),
  };
}

function mergeConfig(
  defaults: ResolvedAIDriftConfig,
  manifest: PartialAIDriftConfig,
  env: PartialAIDriftConfig,
  cli: PartialAIDriftConfig,
): PartialAIDriftConfig {
  return {
    ...defaults,
    ...manifest,
    ...env,
    ...cli,
  };
}

function envToConfig(env: AIDriftEnv): PartialAIDriftConfig {
  return {
    configPath: env.AIDRIFT_CONFIG,
    format: env.AIDRIFT_FORMAT,
    logLevel: env.AIDRIFT_LOG_LEVEL,
    color: env.NO_COLOR === undefined ? undefined : false,
  };
}

function resolveLogLevel(input: {
  readonly defaults: ResolvedAIDriftConfig;
  readonly manifest: PartialAIDriftConfig;
  readonly env: PartialAIDriftConfig;
  readonly cli: PartialAIDriftConfig;
}): LogLevel {
  if (input.cli.quiet) {
    return "error";
  }

  if (input.cli.debug) {
    return "debug";
  }

  if (input.cli.verbose) {
    return "info";
  }

  const configured = input.cli.logLevel ?? input.env.logLevel ?? input.manifest.logLevel;
  return normalizeLogLevel(configured, input.defaults.logLevel);
}

function resolveColor(input: {
  readonly defaults: ResolvedAIDriftConfig;
  readonly manifest: PartialAIDriftConfig;
  readonly env: PartialAIDriftConfig;
  readonly cli: PartialAIDriftConfig;
}): boolean {
  if (input.cli.noColor) {
    return false;
  }

  return input.cli.color ?? input.env.color ?? input.manifest.color ?? input.defaults.color;
}

function normalizeLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  return LOG_LEVELS.has(value as LogLevel) ? (value as LogLevel) : fallback;
}

function normalizeOutputFormat(value: string | undefined, fallback: OutputFormat): OutputFormat {
  return OUTPUT_FORMATS.has(value as OutputFormat) ? (value as OutputFormat) : fallback;
}
