export type ArtifactKind = "prompt" | "tool_schema" | "rag_config" | "model_env_ref";

export interface DetectedArtifact {
  readonly kind: ArtifactKind;
  readonly absolutePath: string;
  readonly relativePath: string; // relative to scan root
}

export interface ScanResult {
  readonly root: string; // absolute path of scanned directory
  readonly artifacts: readonly DetectedArtifact[];
}

export interface ScanProjectOptions {
  readonly dir: string; // absolute path of directory to scan
}
