export const SNAPSHOT_SCHEMA_VERSION = "1";

export type ArtifactKind = "text" | "binary" | "model";
export type SnapshotContentType = "text" | "json" | "yaml";

export interface SnapshotArtifact {
  readonly kind: ArtifactKind;
  readonly hash: string; // sha256:<hex>
  readonly sizeBytes?: number | undefined;
  // text only — undefined for binary/model
  readonly content?: string | undefined;
  readonly contentType?: SnapshotContentType | undefined;
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

export interface EvalBaselineSample {
  readonly output: string;
  readonly score: number;
  readonly latencyMs: number;
  readonly costUsd?: number | undefined;
}

export interface EvalSnapshotBaseline {
  readonly score: number;
  readonly providerId?: string | undefined;
  readonly modelName?: string | undefined;
  readonly model?: string | undefined;
  readonly promptNames?: readonly string[] | undefined;
  readonly samples?: readonly EvalBaselineSample[] | undefined;
  readonly capturedAt?: string | undefined;
  readonly snapshotId?: string | undefined;
}

export interface ProbeBaselineSampleEvidence {
  readonly output: string;
  readonly latencyMs: number;
  readonly costUsd?: number | undefined;
}

export interface ProbeSnapshotBaseline {
  readonly output: string;
  readonly score?: number | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly probeId?: string | undefined;
  readonly samples?: readonly ProbeBaselineSampleEvidence[] | undefined;
  readonly capturedAt?: string | undefined;
  readonly snapshotId?: string | undefined;
}

export interface Snapshot {
  readonly schemaVersion: string;
  readonly id: string; // snap_YYYYMMDD_HHMMSS_mmm_<random>
  readonly label?: string | undefined;
  readonly message?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly timestamp: string; // ISO 8601
  readonly manifestHash: string; // sha256:<hex>
  readonly artifacts: Record<string, SnapshotArtifact>;
  readonly eval?:
    | {
        readonly baselines?: Record<string, EvalSnapshotBaseline>;
      }
    | undefined;
  readonly probe?:
    | {
        readonly baselines?: Record<string, ProbeSnapshotBaseline>;
      }
    | undefined;
  readonly metadata: SnapshotMetadata;
}

export interface SnapshotSummary {
  readonly id: string;
  readonly label?: string | undefined;
  readonly timestamp: string;
  readonly artifactCount: number;
  readonly changedArtifactCount: number;
  readonly changes: SnapshotChangeSummary;
  readonly gitCommit?: string | undefined;
  readonly gitBranch?: string | undefined;
}

export interface SnapshotChangeSummary {
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  readonly artifactKeys: readonly string[];
}
