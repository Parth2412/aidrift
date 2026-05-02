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
        readonly capturedAt?: string | undefined;
        readonly snapshotId?: string | undefined;
      }
    >;
  };
}

export async function loadLatestProbeBaselines(projectRoot: string): Promise<LoadedProbeBaselines> {
  const snapshots = await listSnapshots(projectRoot);
  const latest = snapshots[0];
  if (latest === undefined) {
    return { baselines: {} };
  }

  const snapshot = (await readSnapshot(projectRoot, latest.id)) as SnapshotWithProbeBaselines;
  const rawBaselines = snapshot.probe?.baselines ?? {};
  const baselines: Record<string, ProbeBaseline> = {};

  for (const [key, baseline] of Object.entries(rawBaselines)) {
    baselines[key] = {
      output: baseline.output,
      score: baseline.score ?? 1,
      capturedAt: baseline.capturedAt ?? snapshot.timestamp,
      snapshotId: baseline.snapshotId ?? snapshot.id,
    };
  }

  return { snapshotId: snapshot.id, baselines };
}

export function probeBaselineKey(modelName: string, probeId: string): string {
  return `${modelName}/${probeId}`;
}
