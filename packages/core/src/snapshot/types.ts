export const SNAPSHOT_SCHEMA_VERSION = "1";

export type ArtifactKind = "text" | "binary" | "model";

export interface SnapshotArtifact {
  readonly kind: ArtifactKind;
  readonly hash: string; // sha256:<hex>
  readonly sizeBytes?: number | undefined;
  // text only — undefined for binary/model
  readonly content?: string | undefined;
  // model only
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly path?: string | undefined;
  readonly lastModified?: string | undefined; // ISO 8601
}

export interface SnapshotMetadata {
  readonly gitCommit?: string | undefined;
  readonly gitBranch?: string | undefined;
  readonly gitDirty?: boolean | undefined;
  readonly cliVersion: string;
  readonly nodeVersion: string;
  readonly os: string;
}

export interface Snapshot {
  readonly schemaVersion: string;
  readonly id: string; // snap_YYYYMMDD_HHMMSS
  readonly label?: string | undefined;
  readonly message?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly timestamp: string; // ISO 8601
  readonly manifestHash: string; // sha256:<hex>
  readonly artifacts: Record<string, SnapshotArtifact>;
  readonly eval?:
    | {
        readonly baselines?: Record<
          string,
          {
            readonly score: number;
            readonly capturedAt?: string | undefined;
            readonly snapshotId?: string | undefined;
          }
        >;
      }
    | undefined;
  readonly metadata: SnapshotMetadata;
}

export interface SnapshotSummary {
  readonly id: string;
  readonly label?: string | undefined;
  readonly timestamp: string;
  readonly artifactCount: number;
  readonly gitCommit?: string | undefined;
  readonly gitBranch?: string | undefined;
}
