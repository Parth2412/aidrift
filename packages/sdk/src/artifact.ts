export interface ArtifactConfig {
  readonly type: string;
  readonly path?: string | undefined;
  readonly glob?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface DiffResult {
  readonly changed: boolean;
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface ArtifactResolver {
  readonly type: string;
  readonly provider: string;
  hash(config: ArtifactConfig): Promise<string>;
  diff(baseline: string, current: string): Promise<DiffResult>;
}
