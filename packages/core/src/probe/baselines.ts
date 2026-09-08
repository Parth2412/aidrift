import { listSnapshots, readSnapshot } from "../snapshot/storage.js";
import type { ProbeBaseline, ProbeBaselineMap } from "./types.js";

export interface LoadedProbeBaselines {
  readonly snapshotId?: string | undefined;
  readonly baselines: ProbeBaselineMap;
}

interface SnapshotWithProbeBaselines {
  readonly id: string;
  readonly timestamp: string;
  readonly probe?: {
    readonly baselines?: Record<
      string,
      {
        readonly output: string;
        readonly score?: number | undefined;
        readonly provider?: string | undefined;
        readonly model?: string | undefined;
        readonly modelName?: string | undefined;
        readonly probeId?: string | undefined;
        readonly samples?: readonly {
          readonly output: string;
          readonly latencyMs?: number | undefined;
          readonly costUsd?: number | undefined;
        }[];
        readonly capturedAt?: string | undefined;
        readonly snapshotId?: string | undefined;
      }
    >;
  };
}

export async function loadLatestProbeBaselines(
  projectRoot: string,
  storagePath?: string,
): Promise<LoadedProbeBaselines> {
  const snapshots = await listSnapshots(projectRoot, storagePath);
  const latest = snapshots[0];
  if (latest === undefined) {
    return { baselines: {} };
  }

  return loadProbeBaselinesForSnapshot(projectRoot, latest.id, storagePath);
}

export async function loadProbeBaselinesForSnapshot(
  projectRoot: string,
  snapshotId: string,
  storagePath?: string,
): Promise<LoadedProbeBaselines> {
  const snapshot = (await readSnapshot(
    projectRoot,
    snapshotId,
    storagePath,
  )) as SnapshotWithProbeBaselines;
  const rawBaselines = snapshot.probe?.baselines ?? {};
  const baselines: Record<string, ProbeBaseline> = {};

  for (const [key, baseline] of Object.entries(rawBaselines)) {
    baselines[key] = {
      output: baseline.output,
      score: baseline.score ?? 1,
      capturedAt: baseline.capturedAt ?? snapshot.timestamp,
      snapshotId: baseline.snapshotId ?? snapshot.id,
      provider: baseline.provider,
      model: baseline.model,
      modelName: baseline.modelName,
      probeId: baseline.probeId,
      samples:
        baseline.samples === undefined
          ? [{ output: baseline.output }]
          : baseline.samples.map((sample) => ({
              output: sample.output,
              ...(sample.latencyMs !== undefined ? { latencyMs: sample.latencyMs } : {}),
              ...(sample.costUsd !== undefined ? { costUsd: sample.costUsd } : {}),
            })),
    };
  }

  return { snapshotId: snapshot.id, baselines };
}

export function probeBaselineKey(modelName: string, probeId: string): string {
  return `${modelName}/${probeId}`;
}
