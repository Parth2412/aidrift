export type DiffStatus = "unchanged" | "added" | "removed" | "modified";

export interface ArtifactDiffResult {
  readonly artifactKey: string;
  readonly status: DiffStatus;
  readonly kind: "text" | "binary" | "model";
  readonly hashA?: string | undefined;
  readonly hashB?: string | undefined;
  readonly textDiff?: string | undefined;         // unified diff for text
  readonly jsonDiff?: JsonDiffEntry[] | undefined; // for JSON/YAML
  readonly paramDiff?: ParamDiffEntry[] | undefined; // for model params
}

export interface JsonDiffEntry {
  readonly key: string;
  readonly status: "added" | "removed" | "modified";
  readonly valueA?: unknown;
  readonly valueB?: unknown;
}

export interface ParamDiffEntry {
  readonly param: string;
  readonly status: "added" | "removed" | "modified";
  readonly valueA?: unknown;
  readonly valueB?: unknown;
}

export interface SnapshotDiffResult {
  readonly snapshotIdA: string;
  readonly snapshotIdB: string;
  readonly artifacts: readonly ArtifactDiffResult[];
  readonly changedCount: number;
  readonly unchangedCount: number;
  readonly addedCount: number;
  readonly removedCount: number;
}
