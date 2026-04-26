export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export type OutputFormat = "text" | "json" | "yaml" | "markdown" | "junit" | "github-annotations";

export interface ResolvedAIDriftConfig {
  readonly configPath: string | undefined;
  readonly format: OutputFormat;
  readonly logLevel: LogLevel;
  readonly color: boolean;
}

export interface PartialAIDriftConfig {
  readonly configPath?: string | undefined;
  readonly format?: string | undefined;
  readonly logLevel?: string | undefined;
  readonly color?: boolean | undefined;
  readonly noColor?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  readonly debug?: boolean | undefined;
  readonly quiet?: boolean | undefined;
}

export interface AIDriftEnv {
  readonly AIDRIFT_CONFIG?: string | undefined;
  readonly AIDRIFT_FORMAT?: string | undefined;
  readonly AIDRIFT_LOG_LEVEL?: string | undefined;
  readonly NO_COLOR?: string | undefined;
}

export interface AIDriftConfigInput {
  readonly defaults?: ResolvedAIDriftConfig | undefined;
  readonly manifest?: PartialAIDriftConfig | undefined;
  readonly env?: AIDriftEnv | undefined;
  readonly cli?: PartialAIDriftConfig | undefined;
}
