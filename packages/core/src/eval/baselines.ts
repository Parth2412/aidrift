import { listSnapshots, readSnapshot } from "../snapshot/storage.js";
import type { AssertionBaseline, AssertionBaselineMap } from "./types.js";

export interface LoadedEvalBaselines {
  readonly snapshotId?: string | undefined;
  readonly baselines: AssertionBaselineMap;
}

export async function loadLatestEvalBaselines(projectRoot: string): Promise<LoadedEvalBaselines> {
  const snapshots = await listSnapshots(projectRoot);
  const latest = snapshots[0];
  if (latest === undefined) {
    return { baselines: {} };
  }

  const snapshot = await readSnapshot(projectRoot, latest.id);
  const rawBaselines = snapshot.eval?.baselines ?? {};
  const baselines: Record<string, AssertionBaseline> = {};

  for (const [assertionId, baseline] of Object.entries(rawBaselines)) {
    baselines[assertionId] = {
      score: baseline.score,
      capturedAt: baseline.capturedAt ?? snapshot.timestamp,
      snapshotId: baseline.snapshotId ?? snapshot.id,
    };
  }

  return { snapshotId: snapshot.id, baselines };
}
