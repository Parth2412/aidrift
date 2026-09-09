export type ArtifactKind =
  | "prompt"
  | "tool_schema"
  | "rag_config"
  | "safety_rules"
  | "model_env_ref";

export type DetectedModelProviderName = "openai" | "anthropic" | "cohere";

export interface DetectedModelProvider {
  readonly name: DetectedModelProviderName;
  readonly ecosystem: "javascript" | "python";
  readonly dependency: string;
  readonly relativePath: string;
}

export interface DetectedArtifact {
  readonly kind: ArtifactKind;
  readonly absolutePath: string;
  readonly relativePath: string; // relative to scan root
}

export interface ScanResult {
  readonly root: string; // absolute path of scanned directory
  readonly artifacts: readonly DetectedArtifact[];
  readonly modelProviders: readonly DetectedModelProvider[];
}

export interface ScanProjectOptions {
  readonly dir: string; // absolute path of directory to scan
}
