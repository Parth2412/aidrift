import fs from "node:fs/promises";
import path from "node:path";

import { AIDriftError, ExitCode } from "../errors.js";
import type { Snapshot, SnapshotSummary } from "./types.js";

export function resolveSnapshotsDir(projectRoot: string): string {
  return path.join(projectRoot, ".aidrift", "snapshots");
}

export async function writeSnapshot(projectRoot: string, snapshot: Snapshot): Promise<void> {
  const dir = resolveSnapshotsDir(projectRoot);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${snapshot.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function readSnapshot(projectRoot: string, id: string): Promise<Snapshot> {
  const filePath = path.join(resolveSnapshotsDir(projectRoot), `${id}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (cause) {
    throw new AIDriftError({
      code: "snapshot_not_found",
      exitCode: ExitCode.ConfigError,
      what: `Snapshot not found: ${id}`,
      why: "No snapshot file exists with this ID.",
      fix: `Run 'aidrift history' to list available snapshots.`,
      cause,
    });
  }
  return JSON.parse(raw) as Snapshot;
}

export async function listSnapshots(projectRoot: string): Promise<SnapshotSummary[]> {
  const dir = resolveSnapshotsDir(projectRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = entries
    .filter((e) => e.endsWith(".json"))
    .sort()
    .reverse();

  const summaries: SnapshotSummary[] = [];
  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      const snap = JSON.parse(raw) as Snapshot;
      summaries.push({
        id: snap.id,
        label: snap.label,
        timestamp: snap.timestamp,
        artifactCount: Object.keys(snap.artifacts).length,
        gitCommit: snap.metadata.gitCommit,
        gitBranch: snap.metadata.gitBranch,
      });
    } catch {
      // skip corrupt snapshot files
    }
  }
  return summaries;
}
