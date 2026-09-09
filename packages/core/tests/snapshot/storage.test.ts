import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { loadLatestEvalBaselines } from "../../src/eval/baselines.js";
import { loadLatestProbeBaselines } from "../../src/probe/baselines.js";
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
    manifestHash: `sha256:${"0".repeat(64)}`,
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

  it.skipIf(process.platform === "win32")("writes owner-only storage permissions", async () => {
    const snap = makeSnapshot("snap_20260101_120030");
    await writeSnapshot(tmpDir, snap);
    const directoryMode = (await fs.stat(resolveSnapshotsDir(tmpDir))).mode & 0o777;
    const fileMode =
      (await fs.stat(path.join(resolveSnapshotsDir(tmpDir), `${snap.id}.json`))).mode & 0o777;

    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
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

  it("honors a safe non-default storage path", async () => {
    const snap = makeSnapshot("snap_20260101_140000");
    await writeSnapshot(tmpDir, snap, "./state/baselines");

    expect(await readSnapshot(tmpDir, snap.id, "./state/baselines")).toMatchObject({
      id: snap.id,
    });
    expect(await fs.readdir(path.join(tmpDir, "state", "baselines"))).toEqual([`${snap.id}.json`]);
  });

  it("loads eval and probe baselines from configured storage", async () => {
    const storagePath = "./state/baselines";
    const snap: Snapshot = {
      ...makeSnapshot("snap_20260101_141000"),
      eval: { baselines: { greeting: { score: 0.9 } } },
      probe: { baselines: { "primary/probe": { output: "stable", score: 1 } } },
    };
    await writeSnapshot(tmpDir, snap, storagePath);

    await expect(loadLatestEvalBaselines(tmpDir, storagePath)).resolves.toMatchObject({
      snapshotId: snap.id,
      baselines: { greeting: { score: 0.9 } },
    });
    await expect(loadLatestProbeBaselines(tmpDir, storagePath)).resolves.toMatchObject({
      snapshotId: snap.id,
      baselines: { "primary/probe": { output: "stable", score: 1 } },
    });
  });

  it("never overwrites an existing snapshot ID", async () => {
    const snap = makeSnapshot("snap_20260101_150000");
    await writeSnapshot(tmpDir, snap);

    await expect(writeSnapshot(tmpDir, { ...snap, label: "replacement" })).rejects.toMatchObject({
      code: "snapshot.id.conflict",
      exitCode: 2,
    });
    expect((await readSnapshot(tmpDir, snap.id)).label).toBeUndefined();
  });

  it("rejects unsafe storage paths and snapshot IDs", async () => {
    expect(() => resolveSnapshotsDir(tmpDir, "../outside")).toThrow(
      expect.objectContaining({ code: "path.outside_project" }),
    );
    await expect(readSnapshot(tmpDir, "../../secret")).rejects.toMatchObject({
      code: "snapshot.id.invalid",
      exitCode: 2,
    });
  });

  it("reports corrupt snapshot files instead of silently skipping them", async () => {
    const snapshotsDir = resolveSnapshotsDir(tmpDir);
    await fs.mkdir(snapshotsDir, { recursive: true });
    await fs.writeFile(path.join(snapshotsDir, "snap_corrupt.json"), "{", "utf8");

    await expect(listSnapshots(tmpDir)).rejects.toMatchObject({
      code: "snapshot.corrupt",
      exitCode: 2,
    });
  });

  it("reports schema-invalid snapshot files", async () => {
    const snapshotsDir = resolveSnapshotsDir(tmpDir);
    await fs.mkdir(snapshotsDir, { recursive: true });
    await fs.writeFile(path.join(snapshotsDir, "snap_invalid.json"), "{}", "utf8");

    await expect(readSnapshot(tmpDir, "snap_invalid")).rejects.toMatchObject({
      code: "snapshot.corrupt",
    });
  });

  it("rejects tampered text artifacts and secret-bearing snapshot evidence", async () => {
    const tampered: Snapshot = {
      ...makeSnapshot("snap_tampered"),
      artifacts: {
        "prompts/system": {
          kind: "text",
          hash: `sha256:${"0".repeat(64)}`,
          content: "changed without updating the hash",
        },
      },
    };
    await expect(writeSnapshot(tmpDir, tampered)).rejects.toMatchObject({
      code: "snapshot.corrupt",
      why: expect.stringContaining("does not match its recorded hash"),
    });

    await expect(
      writeSnapshot(tmpDir, {
        ...makeSnapshot("snap_secret"),
        label: "sk-secretvalue123456789",
      }),
    ).rejects.toMatchObject({
      code: "snapshot.corrupt",
      why: expect.stringContaining("Secret-like content"),
    });
  });

  it("rejects persisted baseline collections above runtime sample limits", async () => {
    await expect(
      writeSnapshot(tmpDir, {
        ...makeSnapshot("snap_too_many_samples"),
        eval: {
          baselines: {
            oversized: {
              score: 1,
              samples: Array.from({ length: 101 }, () => ({
                output: "ok",
                score: 1,
                latencyMs: 1,
              })),
            },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "snapshot.corrupt" });
  });

  it("rejects oversized snapshot files before reading them", async () => {
    const snapshotsDir = resolveSnapshotsDir(tmpDir);
    const filename = path.join(snapshotsDir, "snap_oversized.json");
    await fs.mkdir(snapshotsDir, { recursive: true });
    await fs.writeFile(filename, "", "utf8");
    await fs.truncate(filename, 128 * 1024 * 1024 + 1);

    await expect(readSnapshot(tmpDir, "snap_oversized")).rejects.toMatchObject({
      code: "snapshot.too_large",
      exitCode: 2,
    });
  });

  it("rejects snapshot histories above the file-count limit", async () => {
    const snapshotsDir = resolveSnapshotsDir(tmpDir);
    await fs.mkdir(snapshotsDir, { recursive: true });
    await Promise.all(
      Array.from({ length: 1_001 }, async (_, index) =>
        fs.writeFile(
          path.join(snapshotsDir, `snap_limit_${String(index).padStart(4, "0")}.json`),
          "{}",
          "utf8",
        ),
      ),
    );

    await expect(listSnapshots(tmpDir)).rejects.toMatchObject({
      code: "snapshot.storage.limit_exceeded",
      exitCode: 2,
    });
  });

  it("rejects eval baselines whose aggregate score contradicts their samples", async () => {
    const inconsistent = {
      ...makeSnapshot("snap_inconsistent"),
      eval: {
        baselines: {
          policy: {
            score: 1,
            samples: [{ output: "failed", score: 0, latencyMs: 1, costUsd: 0 }],
          },
        },
      },
    };

    await expect(writeSnapshot(tmpDir, inconsistent)).rejects.toMatchObject({
      code: "snapshot.corrupt",
      exitCode: 2,
    });
  });

  it("summarizes artifact changes against the preceding snapshot", async () => {
    const older: Snapshot = {
      ...makeSnapshot("snap_20260101_160000"),
      timestamp: "2026-01-01T16:00:00.000Z",
      artifacts: {
        "prompts/system": {
          kind: "text",
          hash: "sha256:cba06b5736faf67e54b07b561eae94395e774c517a7d910a54369e1263ccfbd4",
          content: "old",
        },
      },
    };
    const newer: Snapshot = {
      ...makeSnapshot("snap_20260101_170000"),
      timestamp: "2026-01-01T17:00:00.000Z",
      artifacts: {
        "prompts/system": {
          kind: "text",
          hash: "sha256:11507a0e2f5e69d5dfa40a62a1bd7b6ee57e6bcd85c67c9b8431b36fff21c437",
          content: "new",
        },
        "models/primary": { kind: "model", hash: `sha256:${"1".repeat(64)}` },
      },
    };
    await writeSnapshot(tmpDir, older);
    await writeSnapshot(tmpDir, newer);

    const summaries = await listSnapshots(tmpDir);
    expect(summaries[0]).toMatchObject({
      id: newer.id,
      changedArtifactCount: 2,
      changes: { added: 1, modified: 1, removed: 0 },
    });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a storage symlink that escapes the project",
    async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-storage-outside-"));
      try {
        await fs.symlink(outside, path.join(tmpDir, "linked-storage"));
        await expect(listSnapshots(tmpDir, "./linked-storage")).rejects.toMatchObject({
          code: "path.symlink_escape",
        });
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects an individual snapshot symlink that escapes the project",
    async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-snapshot-outside-"));
      const snapshotsDir = resolveSnapshotsDir(tmpDir);
      try {
        const snapshot = makeSnapshot("snap_linked");
        await fs.mkdir(snapshotsDir, { recursive: true });
        const outsideFile = path.join(outside, "snapshot.json");
        await fs.writeFile(outsideFile, JSON.stringify(snapshot), "utf8");
        await fs.symlink(outsideFile, path.join(snapshotsDir, "snap_linked.json"));

        await expect(readSnapshot(tmpDir, "snap_linked")).rejects.toMatchObject({
          code: "path.symlink_escape",
          exitCode: 2,
        });
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    },
  );
});
