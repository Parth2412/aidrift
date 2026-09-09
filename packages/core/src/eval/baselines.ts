import { listSnapshots, readSnapshot } from "../snapshot/storage.js";
import type { AssertionBaseline, AssertionBaselineMap } from "./types.js";

export interface LoadedEvalBaselines {
  readonly snapshotId?: string | undefined;
  readonly baselines: AssertionBaselineMap;
}

export async function loadLatestEvalBaselines(
  projectRoot: string,
  storagePath?: string,
): Promise<LoadedEvalBaselines> {
  const snapshots = await listSnapshots(projectRoot, storagePath);
  const latest = snapshots[0];
  if (latest === undefined) {
    return { baselines: {} };
  }

  return loadEvalBaselinesForSnapshot(projectRoot, latest.id, storagePath);
}

export async function loadEvalBaselinesForSnapshot(
  projectRoot: string,
  snapshotId: string,
  storagePath?: string,
): Promise<LoadedEvalBaselines> {
  const snapshot = await readSnapshot(projectRoot, snapshotId, storagePath);
  const rawBaselines = snapshot.eval?.baselines ?? {};
  const baselines: Record<string, AssertionBaseline> = {};

  for (const [assertionId, baseline] of Object.entries(rawBaselines)) {
    baselines[assertionId] = {
      score: baseline.score,
      scores: baseline.samples?.map((sample) => sample.score) ?? [baseline.score],
      capturedAt: baseline.capturedAt ?? snapshot.timestamp,
      snapshotId: baseline.snapshotId ?? snapshot.id,
    };
  }

  return { snapshotId: snapshot.id, baselines };
}
