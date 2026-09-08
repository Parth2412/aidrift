export const MANIFEST_VERSION = "1";

export const RECOGNIZED_MODEL_PROVIDERS = [
  "mock",
  "openai",
  "anthropic",
  "cohere",
  "google",
  "mistral",
  "local",
  "custom",
] as const;

export type ModelProvider = (typeof RECOGNIZED_MODEL_PROVIDERS)[number];

export type ManifestIssueSeverity = "error" | "warning";

export interface ManifestValidationIssue {
  readonly severity: ManifestIssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly manifestPath?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly fix?: string | undefined;
}

export interface ResolvedManifestPath {
  readonly manifestPath: string;
  readonly sourcePath: string;
  readonly absolutePath: string;
  readonly kind: "file" | "directory" | "glob";
  readonly matches?: readonly string[] | undefined;
}

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly manifestPath: string;
  readonly manifest?: AIStateManifest | undefined;
  readonly errors: readonly ManifestValidationIssue[];
  readonly warnings: readonly ManifestValidationIssue[];
  readonly resolvedPaths: readonly ResolvedManifestPath[];
}

export interface ValidateManifestFileOptions {
  readonly manifestPath: string;
  readonly strict?: boolean | undefined;
}

export interface ValidateManifestSourceOptions extends ValidateManifestFileOptions {
  readonly source: string;
}

export interface AIStateManifest {
  readonly version: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly artifacts: ArtifactGroups;
  readonly eval: EvalConfig;
  readonly storage: StorageConfig;
  readonly plugins?: readonly PluginConfig[] | undefined;
}

export interface ArtifactGroups {
  readonly prompts?: Record<string, PromptArtifact> | undefined;
  readonly models?: Record<string, ModelArtifact> | undefined;
  readonly rag?: Record<string, RAGArtifact> | undefined;
  readonly tools?: Record<string, ToolArtifact> | undefined;
  readonly safety?: Record<string, SafetyArtifact> | undefined;
  readonly adapters?: Record<string, AdapterArtifact> | undefined;
  readonly custom?: Record<string, CustomArtifact> | undefined;
}

export interface ArtifactBase {
  readonly type: string;
  readonly path?: string | undefined;
  readonly glob?: string | undefined;
  readonly hash_algorithm?: "sha256" | "md5" | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface PromptArtifact extends ArtifactBase {
  readonly type: "prompt";
  readonly path: string;
  readonly format?: "text" | "json" | "jinja2" | "mustache" | undefined;
}

export interface ModelArtifact extends ArtifactBase {
  readonly type: "model";
  readonly provider: string;
  readonly model: string;
  readonly parameters?: Record<string, unknown> | undefined;
}

export interface RAGArtifact extends ArtifactBase {
  readonly type: "rag_config";
  readonly path: string;
  readonly index_hash_command?: string | undefined;
}

export interface ToolArtifact extends ArtifactBase {
  readonly type: "tool_schema";
  readonly path: string;
  readonly glob?: string | undefined;
}

export interface SafetyArtifact extends ArtifactBase {
  readonly type: "safety_rules";
  readonly path: string;
}

export interface AdapterArtifact extends ArtifactBase {
  readonly type: "adapter";
  readonly path: string;
  readonly hash_algorithm?: "sha256" | "md5" | undefined;
}

export interface CustomArtifact extends ArtifactBase {
  readonly type: "custom";
}

export interface EvalConfig {
  readonly suite: string;
  readonly format?: "aidrift" | "promptfoo" | undefined;
  readonly samples_per_assertion?: number | undefined;
  readonly significance_level?: number | undefined;
  readonly timeout_seconds?: number | undefined;
  readonly target?: EvalTargetConfig | undefined;
}

export type EvalTargetConfig = ProviderEvalTargetConfig | ExternalEvalTargetConfig;

export interface ProviderEvalTargetConfig {
  readonly type: "provider";
  readonly model: string;
  readonly prompts?: readonly string[] | undefined;
}

export interface ExternalEvalTargetConfig {
  readonly type: "http" | "subprocess";
  readonly [key: string]: unknown;
}

export interface StorageConfig {
  readonly backend: "local" | "git";
  readonly path: string;
}

export type PluginConfig =
  | string
  | { readonly name: string; readonly version?: string; readonly options?: unknown };
