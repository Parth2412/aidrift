import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AIStateManifest } from "../manifest/types.js";
import { hashFile, hashString } from "./hasher.js";
import type { Snapshot, SnapshotArtifact, SnapshotMetadata } from "./types.js";
import { SNAPSHOT_SCHEMA_VERSION } from "./types.js";

export interface CaptureSnapshotOptions {
  readonly manifest: AIStateManifest;
  readonly manifestPath: string;
  readonly projectRoot: string;
  readonly cliVersion: string;
  readonly label?: string | undefined;
  readonly message?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

function generateSnapshotId(): string {
  const now = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `snap_${date}_${time}`;
}

async function captureTextArtifact(
  absolutePath: string,
): Promise<SnapshotArtifact> {
  const content = await fs.readFile(absolutePath, "utf8");
  const hash = hashString(content);
  const stat = await fs.stat(absolutePath);
  return {
    kind: "text",
    hash,
    sizeBytes: stat.size,
    content,
    path: absolutePath,
    lastModified: stat.mtime.toISOString(),
  };
}

function captureModelArtifact(artifact: {
  readonly provider: string;
  readonly model: string;
  readonly parameters?: Record<string, unknown> | undefined;
}): SnapshotArtifact {
  const paramStr = JSON.stringify({
    provider: artifact.provider,
    model: artifact.model,
    parameters: artifact.parameters ?? {},
  });
  const hash = hashString(paramStr);
  return {
    kind: "model",
    hash,
    provider: artifact.provider,
    model: artifact.model,
    parameters: artifact.parameters,
  };
}

async function collectGitMetadata(): Promise<{
  gitCommit?: string;
  gitBranch?: string;
  gitDirty?: boolean;
}> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const [commitResult, branchResult, statusResult] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--short", "HEAD"]).catch(() => ({ stdout: "" })),
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({ stdout: "" })),
      execFileAsync("git", ["status", "--porcelain"]).catch(() => ({ stdout: "" })),
    ]);

    return {
      gitCommit: commitResult.stdout.trim() || undefined,
      gitBranch: branchResult.stdout.trim() || undefined,
      gitDirty: statusResult.stdout.trim().length > 0,
    };
  } catch {
    return {};
  }
}

export async function captureSnapshot(options: CaptureSnapshotOptions): Promise<Snapshot> {
  const { manifest, manifestPath, cliVersion, label, message, tags } = options;

  const manifestContent = await fs.readFile(manifestPath, "utf8").catch(() => "");
  const manifestHash = hashString(manifestContent);

  const artifacts: Record<string, SnapshotArtifact> = {};

  // prompts
  if (manifest.artifacts.prompts !== undefined) {
    for (const [name, artifact] of Object.entries(manifest.artifacts.prompts)) {
      const absPath = path.isAbsolute(artifact.path)
        ? artifact.path
        : path.resolve(path.dirname(manifestPath), artifact.path);
      artifacts[`prompts/${name}`] = await captureTextArtifact(absPath);
    }
  }

  // models
  if (manifest.artifacts.models !== undefined) {
    for (const [name, artifact] of Object.entries(manifest.artifacts.models)) {
      artifacts[`models/${name}`] = captureModelArtifact(artifact);
    }
  }

  // rag configs (text)
  if (manifest.artifacts.rag !== undefined) {
    for (const [name, artifact] of Object.entries(manifest.artifacts.rag)) {
      const absPath = path.isAbsolute(artifact.path)
        ? artifact.path
        : path.resolve(path.dirname(manifestPath), artifact.path);
      artifacts[`rag/${name}`] = await captureTextArtifact(absPath);
    }
  }

  // tools (text/json)
  if (manifest.artifacts.tools !== undefined) {
    for (const [name, artifact] of Object.entries(manifest.artifacts.tools)) {
      const absPath = path.isAbsolute(artifact.path)
        ? artifact.path
        : path.resolve(path.dirname(manifestPath), artifact.path);
      artifacts[`tools/${name}`] = await captureTextArtifact(absPath);
    }
  }

  // safety rules (text)
  if (manifest.artifacts.safety !== undefined) {
    for (const [name, artifact] of Object.entries(manifest.artifacts.safety)) {
      const absPath = path.isAbsolute(artifact.path)
        ? artifact.path
        : path.resolve(path.dirname(manifestPath), artifact.path);
      artifacts[`safety/${name}`] = await captureTextArtifact(absPath);
    }
  }

  // adapters (binary — hash only)
  if (manifest.artifacts.adapters !== undefined) {
    for (const [name, artifact] of Object.entries(manifest.artifacts.adapters)) {
      const absPath = path.isAbsolute(artifact.path)
        ? artifact.path
        : path.resolve(path.dirname(manifestPath), artifact.path);
      const hash = await hashFile(absPath);
      const stat = await fs.stat(absPath);
      artifacts[`adapters/${name}`] = {
        kind: "binary",
        hash,
        sizeBytes: stat.size,
        path: absPath,
        lastModified: stat.mtime.toISOString(),
      };
    }
  }

  const gitMeta = await collectGitMetadata();
  const metadata: SnapshotMetadata = {
    ...gitMeta,
    cliVersion,
    nodeVersion: process.version,
    os: `${process.platform}-${os.arch()}`,
  };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: generateSnapshotId(),
    label,
    message,
    tags,
    timestamp: new Date().toISOString(),
    manifestHash,
    artifacts,
    metadata,
  };
}
