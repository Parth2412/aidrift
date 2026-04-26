import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { Snapshot } from "../../src/snapshot/types.js";
import { SNAPSHOT_SCHEMA_VERSION } from "../../src/snapshot/types.js";
import {
  writeSnapshot,
  readSnapshot,
  listSnapshots,
  resolveSnapshotsDir,
} from "../../src/snapshot/storage.js";

function makeSnapshot(id: string): Snapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id,
    timestamp: new Date().toISOString(),
    manifestHash: "sha256:abc123",
    artifacts: {},
    metadata: {
      cliVersion: "0.0.0",
      nodeVersion: process.version,
      os: process.platform,
    },
  };
}

describe("snapshot storage", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-storage-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("resolveSnapshotsDir returns .aidrift/snapshots under projectRoot", () => {
    const result = resolveSnapshotsDir(tmpDir);
    expect(result).toBe(path.join(tmpDir, ".aidrift", "snapshots"));
  });

  it("writeSnapshot creates a JSON file named <id>.json", async () => {
    const snap = makeSnapshot("snap_20260101_120000");
    await writeSnapshot(tmpDir, snap);
    const filePath = path.join(tmpDir, ".aidrift", "snapshots", "snap_20260101_120000.json");
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Snapshot;
    expect(parsed.id).toBe("snap_20260101_120000");
  });

  it("readSnapshot retrieves a previously written snapshot", async () => {
    const snap = makeSnapshot("snap_20260101_120001");
    await writeSnapshot(tmpDir, snap);
    const loaded = await readSnapshot(tmpDir, "snap_20260101_120001");
    expect(loaded.id).toBe("snap_20260101_120001");
  });

  it("readSnapshot throws when snapshot does not exist", async () => {
    await expect(readSnapshot(tmpDir, "snap_missing")).rejects.toThrow();
  });

  it("listSnapshots returns empty array when no snapshots exist", async () => {
    const result = await listSnapshots(tmpDir);
    expect(result).toEqual([]);
  });

  it("listSnapshots returns snapshots in reverse chronological order", async () => {
    const a = makeSnapshot("snap_20260101_120000");
    const b = makeSnapshot("snap_20260101_130000");
    await writeSnapshot(tmpDir, a);
    await writeSnapshot(tmpDir, b);
    const list = await listSnapshots(tmpDir);
    expect(list[0]?.id).toBe("snap_20260101_130000");
    expect(list[1]?.id).toBe("snap_20260101_120000");
  });
});
