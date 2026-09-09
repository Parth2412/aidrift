import fs from "node:fs/promises";
import path from "node:path";

import { diffSnapshots } from "../diff/engine.js";
import { AIDriftError, ExitCode } from "../errors.js";
import { BoundedFileReadError, readUtf8FileWithinLimit } from "../files/bounded-read.js";
import { assertWritablePathWithinProject, resolvePathWithinProject } from "./paths.js";
import { assertSnapshotValid, parseSnapshotJson } from "./schema.js";
import type { Snapshot, SnapshotChangeSummary, SnapshotSummary } from "./types.js";

export const DEFAULT_SNAPSHOTS_PATH = "./.aidrift/snapshots";
const MAX_SNAPSHOT_FILE_BYTES = 128 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 1_000;
const MAX_STORAGE_DIRECTORY_ENTRIES = 10_000;
const MAX_LIST_SNAPSHOT_BYTES = 256 * 1024 * 1024;

export function resolveSnapshotsDir(
  projectRoot: string,
  storagePath = DEFAULT_SNAPSHOTS_PATH,
): string {
  return resolvePathWithinProject(projectRoot, storagePath, "Snapshot storage path", false);
}

export async function writeSnapshot(
  projectRoot: string,
  snapshot: Snapshot,
  storagePath = DEFAULT_SNAPSHOTS_PATH,
): Promise<void> {
  const dir = resolveSnapshotsDir(projectRoot, storagePath);
  await assertWritablePathWithinProject(projectRoot, dir, "Snapshot storage path");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await assertWritablePathWithinProject(projectRoot, dir, "Snapshot storage path");

  const filePath = snapshotFilePath(dir, snapshot.id);
  assertSnapshotValid(snapshot, filePath);
  const serialized = JSON.stringify(snapshot, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_FILE_BYTES) {
    throw snapshotSizeError(filePath);
  }

  try {
    await fs.writeFile(filePath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (cause) {
    if (isErrorCode(cause, "EEXIST")) {
      throw new AIDriftError({
        code: "snapshot.id.conflict",
        exitCode: ExitCode.ConfigError,
        what: `Snapshot already exists and was not overwritten: ${snapshot.id}`,
        why: "Snapshot IDs are immutable and an existing file has the same ID.",
        fix: "Capture the snapshot again to generate a new ID.",
        docs: "https://github.com/Parth2412/aidrift#readme",
        cause,
      });
    }
    throw new AIDriftError({
      code: "snapshot.write.failed",
      exitCode: ExitCode.ConfigError,
      what: `Cannot write snapshot: ${filePath}`,
      why: "The storage directory is not writable or the filesystem operation failed.",
      fix: "Verify storage.path and filesystem permissions, then retry.",
      docs: "https://github.com/Parth2412/aidrift#readme",
      cause,
    });
  }
}

export async function readSnapshot(
  projectRoot: string,
  id: string,
  storagePath = DEFAULT_SNAPSHOTS_PATH,
): Promise<Snapshot> {
  return (await readSnapshotWithSize(projectRoot, id, storagePath)).snapshot;
}

async function readSnapshotWithSize(
  projectRoot: string,
  id: string,
  storagePath: string,
): Promise<{ readonly snapshot: Snapshot; readonly sizeBytes: number }> {
  const dir = resolveSnapshotsDir(projectRoot, storagePath);
  await assertWritablePathWithinProject(projectRoot, dir, "Snapshot storage path");
  const filePath = snapshotFilePath(dir, id);
  await assertWritablePathWithinProject(projectRoot, filePath, "Snapshot file");
  let raw: string;
  let sizeBytes: number;
  try {
    const boundedFile = await readUtf8FileWithinLimit(filePath, MAX_SNAPSHOT_FILE_BYTES);
    raw = boundedFile.content;
    sizeBytes = boundedFile.sizeBytes;
  } catch (cause) {
    if (cause instanceof AIDriftError) throw cause;
    if (cause instanceof BoundedFileReadError && cause.failure === "too_large") {
      throw snapshotSizeError(filePath);
    }
    throw new AIDriftError({
      code: "snapshot.not_found",
      exitCode: ExitCode.ConfigError,
      what: `Snapshot not found: ${id}`,
      why: "No readable snapshot file exists with this ID.",
      fix: "Run 'aidrift history' to list available snapshots.",
      docs: "https://github.com/Parth2412/aidrift#readme",
      cause,
    });
  }

  const snapshot = parseSnapshotJson(raw, filePath);
  if (snapshot.id !== id) {
    throw new AIDriftError({
      code: "snapshot.corrupt",
      exitCode: ExitCode.ConfigError,
      what: `Snapshot ID does not match its filename: ${filePath}`,
      why: `The file was requested as ${id} but contains ${snapshot.id}.`,
      fix: "Restore or remove the invalid snapshot file, then capture a new baseline.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return { snapshot, sizeBytes };
}

function snapshotSizeError(filePath: string): AIDriftError {
  return new AIDriftError({
    code: "snapshot.too_large",
    exitCode: ExitCode.ConfigError,
    what: `Snapshot exceeds the ${MAX_SNAPSHOT_FILE_BYTES}-byte safety limit: ${filePath}`,
    why: "Reading or writing an unbounded snapshot could exhaust memory.",
    fix: "Narrow captured artifacts or remove the invalid snapshot and capture a smaller baseline.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

export async function listSnapshots(
  projectRoot: string,
  storagePath = DEFAULT_SNAPSHOTS_PATH,
): Promise<SnapshotSummary[]> {
  const dir = resolveSnapshotsDir(projectRoot, storagePath);
  await assertWritablePathWithinProject(projectRoot, dir, "Snapshot storage path");
  let entries: string[];
  try {
    entries = await listSnapshotFiles(dir);
  } catch (cause) {
    if (isErrorCode(cause, "ENOENT")) {
      return [];
    }
    if (cause instanceof AIDriftError) throw cause;
    throw new AIDriftError({
      code: "snapshot.storage.unreadable",
      exitCode: ExitCode.ConfigError,
      what: `Cannot read snapshot storage: ${dir}`,
      why: "The configured storage directory is inaccessible.",
      fix: "Verify storage.path and filesystem permissions.",
      docs: "https://github.com/Parth2412/aidrift#readme",
      cause,
    });
  }

  const snapshots: Snapshot[] = [];
  let totalBytes = 0;
  for (const file of entries) {
    const id = file.slice(0, -".json".length);
    const loaded = await readSnapshotWithSize(projectRoot, id, storagePath);
    totalBytes += loaded.sizeBytes;
    if (totalBytes > MAX_LIST_SNAPSHOT_BYTES) {
      throw snapshotStorageLimitError(
        `Snapshot history exceeds the ${MAX_LIST_SNAPSHOT_BYTES}-byte aggregate read limit.`,
      );
    }
    snapshots.push(loaded.snapshot);
  }
  snapshots.sort(
    (left, right) =>
      Date.parse(right.timestamp) - Date.parse(left.timestamp) || right.id.localeCompare(left.id),
  );

  return snapshots.map((snapshot, index) => {
    const older = snapshots[index + 1];
    const changes = summarizeChanges(older, snapshot);
    return {
      id: snapshot.id,
      label: snapshot.label,
      timestamp: snapshot.timestamp,
      artifactCount: Object.keys(snapshot.artifacts).length,
      changedArtifactCount: changes.artifactKeys.length,
      changes,
      gitCommit: snapshot.metadata.gitCommit,
      gitBranch: snapshot.metadata.gitBranch,
    };
  });
}

async function listSnapshotFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entryCount = 0;
  const directory = await fs.opendir(dir);
  for await (const entry of directory) {
    entryCount += 1;
    if (entryCount > MAX_STORAGE_DIRECTORY_ENTRIES) {
      throw snapshotStorageLimitError(
        `Snapshot storage contains more than ${MAX_STORAGE_DIRECTORY_ENTRIES} entries.`,
      );
    }
    if (!entry.name.endsWith(".json")) continue;
    files.push(entry.name);
    if (files.length > MAX_SNAPSHOT_FILES) {
      throw snapshotStorageLimitError(
        `Snapshot storage contains more than ${MAX_SNAPSHOT_FILES} JSON files.`,
      );
    }
  }
  return files.sort();
}

function snapshotStorageLimitError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "snapshot.storage.limit_exceeded",
    exitCode: ExitCode.ConfigError,
    what: "Snapshot history cannot be loaded within the configured safety limits.",
    why: reason,
    fix: "Archive older snapshots or narrow the configured snapshot storage directory.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function snapshotFilePath(dir: string, id: string): string {
  if (!/^snap_[A-Za-z0-9][A-Za-z0-9_-]{0,123}$/u.test(id)) {
    throw new AIDriftError({
      code: "snapshot.id.invalid",
      exitCode: ExitCode.ConfigError,
      what: `Invalid snapshot ID: ${id}`,
      why: "Snapshot IDs must start with snap_ and contain only letters, numbers, underscores, or hyphens.",
      fix: "Run 'aidrift history' and use an exact snapshot ID from the list.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return path.join(dir, `${id}.json`);
}

function summarizeChanges(older: Snapshot | undefined, current: Snapshot): SnapshotChangeSummary {
  if (older === undefined) {
    const artifactKeys = Object.keys(current.artifacts).sort();
    return { added: artifactKeys.length, modified: 0, removed: 0, artifactKeys };
  }

  const diff = diffSnapshots(older, current);
  const changed = diff.artifacts.filter((artifact) => artifact.status !== "unchanged");
  return {
    added: changed.filter((artifact) => artifact.status === "added").length,
    modified: changed.filter((artifact) => artifact.status === "modified").length,
    removed: changed.filter((artifact) => artifact.status === "removed").length,
    artifactKeys: changed.map((artifact) => artifact.artifactKey),
  };
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
