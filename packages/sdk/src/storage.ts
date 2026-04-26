export interface SnapshotRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface SnapshotMeta {
  readonly id: string;
  readonly createdAt: string;
  readonly label?: string | undefined;
}

export interface ListSnapshotsOptions {
  readonly limit?: number | undefined;
}

export interface StorageBackend {
  readonly name: string;
  save(snapshot: SnapshotRecord): Promise<void>;
  load(id: string): Promise<SnapshotRecord>;
  list(options?: ListSnapshotsOptions): Promise<readonly SnapshotMeta[]>;
  delete(id: string): Promise<void>;
}
