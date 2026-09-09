import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { escape, glob, globIterate } from "glob";

import { AIDriftError, ExitCode } from "../errors.js";
import { readUtf8FileWithinLimit } from "../files/bounded-read.js";
import {
  isProjectPathGitIgnored,
  loadProjectGitIgnore,
  type GitIgnoreContext,
} from "../files/gitignore.js";
import { containsSecretLikeValue } from "../manifest/security.js";
import type { AIStateManifest, ArtifactBase, PromptArtifact } from "../manifest/types.js";
import { hashFile, hashString } from "./hasher.js";
import {
  assertExistingPathWithinProject,
  portableProjectPath,
  resolvePathWithinProject,
} from "./paths.js";
import { assertSnapshotValid } from "./schema.js";
import type { Snapshot, SnapshotArtifact, SnapshotContentType, SnapshotMetadata } from "./types.js";
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

interface ResolvedArtifactFiles {
  readonly files: readonly string[];
  readonly collection: boolean;
  readonly basePath: string;
}

interface CaptureIgnoreRules {
  readonly globPatterns: readonly string[];
  readonly gitIgnoreContexts: readonly GitIgnoreContext[];
}

const MAX_COLLECTION_FILES = 10_000;
const MAX_TEXT_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_CAPTURED_TEXT_BYTES = 64 * 1024 * 1024;
const MAX_BINARY_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_CAPTURED_BINARY_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

export async function captureSnapshot(options: CaptureSnapshotOptions): Promise<Snapshot> {
  const { manifest, manifestPath, cliVersion, label, message, tags } = options;
  const projectRoot = path.resolve(options.projectRoot);
  const manifestDir = path.dirname(path.resolve(manifestPath));
  const manifestContent = await readManifest(manifestPath);
  const artifacts: Record<string, SnapshotArtifact> = {};
  const ignoreRules = await loadCaptureIgnoreRules(projectRoot, manifest.storage.path);
  const captureBudget = new SnapshotCaptureBudget();

  await captureTextGroup(
    artifacts,
    "prompts",
    manifest.artifacts.prompts,
    projectRoot,
    manifestDir,
    ignoreRules,
    captureBudget,
  );
  captureModelGroup(artifacts, manifest.artifacts.models);
  await captureTextGroup(
    artifacts,
    "rag",
    manifest.artifacts.rag,
    projectRoot,
    manifestDir,
    ignoreRules,
    captureBudget,
  );
  await captureTextGroup(
    artifacts,
    "tools",
    manifest.artifacts.tools,
    projectRoot,
    manifestDir,
    ignoreRules,
    captureBudget,
  );
  await captureTextGroup(
    artifacts,
    "safety",
    manifest.artifacts.safety,
    projectRoot,
    manifestDir,
    ignoreRules,
    captureBudget,
  );
  await captureBinaryGroup(
    artifacts,
    "adapters",
    manifest.artifacts.adapters,
    projectRoot,
    manifestDir,
    ignoreRules,
    captureBudget,
  );

  const gitMeta = await collectGitMetadata(projectRoot);
  const metadata: SnapshotMetadata = {
    ...gitMeta,
    cliVersion,
    nodeVersion: process.version,
    os: `${process.platform}-${os.arch()}`,
  };
  const now = new Date();

  const snapshot: Snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id: generateSnapshotId(now),
    label,
    message,
    tags: tags === undefined ? undefined : [...new Set(tags)].sort(),
    timestamp: now.toISOString(),
    manifestHash: hashString(manifestContent),
    artifacts: sortRecord(artifacts),
    metadata,
  };
  return assertSnapshotValid(snapshot, "newly captured snapshot");
}

function generateSnapshotId(now: Date): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `snap_${date}_${time}_${pad(now.getUTCMilliseconds(), 3)}_${randomUUID().slice(0, 8)}`;
}

async function captureTextGroup(
  output: Record<string, SnapshotArtifact>,
  groupName: string,
  group: Record<string, ArtifactBase> | undefined,
  projectRoot: string,
  manifestDir: string,
  ignoreRules: CaptureIgnoreRules,
  captureBudget: SnapshotCaptureBudget,
): Promise<void> {
  for (const [name, artifact] of sortedEntries(group)) {
    if (artifact.path === undefined) {
      continue;
    }
    const resolved = await resolveArtifactFiles(
      projectRoot,
      manifestDir,
      artifact.path,
      artifact.glob,
      ignoreRules,
      `${groupName}/${name}`,
    );

    for (const file of resolved.files) {
      const key = artifactKey(groupName, name, file, resolved);
      output[key] = await captureTextArtifact(
        file,
        portableProjectPath(projectRoot, file),
        detectContentType(file, artifact),
        captureBudget,
      );
    }
  }
}

async function captureBinaryGroup(
  output: Record<string, SnapshotArtifact>,
  groupName: string,
  group: Record<string, ArtifactBase> | undefined,
  projectRoot: string,
  manifestDir: string,
  ignoreRules: CaptureIgnoreRules,
  captureBudget: SnapshotCaptureBudget,
): Promise<void> {
  for (const [name, artifact] of sortedEntries(group)) {
    if (artifact.path === undefined) {
      continue;
    }
    const resolved = await resolveArtifactFiles(
      projectRoot,
      manifestDir,
      artifact.path,
      artifact.glob,
      ignoreRules,
      `${groupName}/${name}`,
    );

    for (const file of resolved.files) {
      const stat = await fs.stat(file);
      captureBudget.reserveFile(portableProjectPath(projectRoot, file));
      captureBudget.reserveBinaryBytes(stat.size, portableProjectPath(projectRoot, file));
      const hash = await hashFile(file, MAX_BINARY_ARTIFACT_BYTES);
      const finalStat = await fs.stat(file);
      if (finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs) {
        throw captureLimitError(
          portableProjectPath(projectRoot, file),
          "The binary artifact changed while its snapshot hash was being captured.",
        );
      }
      output[artifactKey(groupName, name, file, resolved)] = {
        kind: "binary",
        hash,
        sizeBytes: stat.size,
        path: portableProjectPath(projectRoot, file),
        lastModified: stat.mtime.toISOString(),
      };
    }
  }
}

function captureModelGroup(
  output: Record<string, SnapshotArtifact>,
  models: AIStateManifest["artifacts"]["models"],
): void {
  for (const [name, artifact] of sortedEntries(models)) {
    const parameters =
      artifact.parameters === undefined ? undefined : sortObject(artifact.parameters);
    output[`models/${name}`] = {
      kind: "model",
      hash: hashString(
        stableJson({
          provider: artifact.provider,
          model: artifact.model,
          parameters: parameters ?? {},
        }),
      ),
      provider: artifact.provider,
      model: artifact.model,
      parameters,
    };
  }
}

async function captureTextArtifact(
  absolutePath: string,
  portablePath: string,
  contentType: SnapshotContentType,
  captureBudget: SnapshotCaptureBudget,
): Promise<SnapshotArtifact> {
  const stat = await fs.stat(absolutePath);
  captureBudget.reserveFile(portablePath);
  if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
    throw new AIDriftError({
      code: "snapshot.artifact.too_large",
      exitCode: ExitCode.ConfigError,
      what: `Text artifact exceeds the ${MAX_TEXT_ARTIFACT_BYTES}-byte capture limit: ${portablePath}`,
      why: "Embedding an unbounded file could exhaust memory or create an unsafe snapshot.",
      fix: "Reduce or split the text artifact, or represent large binary state as an adapter hash.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  let boundedFile;
  try {
    boundedFile = await readUtf8FileWithinLimit(absolutePath, MAX_TEXT_ARTIFACT_BYTES);
  } catch (cause) {
    throw captureLimitError(
      portablePath,
      `The text artifact could not be read within the ${MAX_TEXT_ARTIFACT_BYTES}-byte limit.`,
      cause,
    );
  }
  captureBudget.reserveTextBytes(boundedFile.sizeBytes, portablePath);
  const content = boundedFile.content;
  if (containsSecretLikeValue(content)) {
    throw new AIDriftError({
      code: "snapshot.artifact.secret_detected",
      exitCode: ExitCode.ConfigError,
      what: `Secret-like content detected in artifact: ${portablePath}`,
      why: "Text artifact contents are persisted in plaintext snapshots.",
      fix: "Remove the credential from the artifact and load it from an environment variable or secret store.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  return {
    kind: "text",
    hash: hashString(content),
    sizeBytes: boundedFile.sizeBytes,
    content,
    contentType,
    path: portablePath,
    lastModified: boundedFile.lastModified.toISOString(),
  };
}

class SnapshotCaptureBudget {
  private fileCount = 0;
  private textBytes = 0;
  private binaryBytes = 0;

  reserveFile(portablePath: string): void {
    this.fileCount += 1;
    if (this.fileCount > MAX_COLLECTION_FILES) {
      throw captureLimitError(
        portablePath,
        `The snapshot exceeds the ${MAX_COLLECTION_FILES}-file global capture limit.`,
      );
    }
  }

  reserveTextBytes(bytes: number, portablePath: string): void {
    this.textBytes += bytes;
    if (this.textBytes > MAX_CAPTURED_TEXT_BYTES) {
      throw captureLimitError(
        portablePath,
        `Captured text exceeds the ${MAX_CAPTURED_TEXT_BYTES}-byte global memory limit.`,
      );
    }
  }

  reserveBinaryBytes(bytes: number, portablePath: string): void {
    if (bytes > MAX_BINARY_ARTIFACT_BYTES) {
      throw captureLimitError(
        portablePath,
        `A binary artifact exceeds the ${MAX_BINARY_ARTIFACT_BYTES}-byte file limit.`,
      );
    }
    this.binaryBytes += bytes;
    if (this.binaryBytes > MAX_CAPTURED_BINARY_BYTES) {
      throw captureLimitError(
        portablePath,
        `Captured binary data exceeds the ${MAX_CAPTURED_BINARY_BYTES}-byte global limit.`,
      );
    }
  }
}

function captureLimitError(portablePath: string, reason: string, cause?: unknown): AIDriftError {
  return new AIDriftError({
    code: "snapshot.capture.limit_exceeded",
    exitCode: ExitCode.ConfigError,
    what: `Snapshot capture limit exceeded at ${portablePath}.`,
    why: reason,
    fix: "Narrow artifact directories/globs or split the behavioral state into smaller projects.",
    docs: "https://github.com/Parth2412/aidrift#readme",
    cause,
  });
}

async function resolveArtifactFiles(
  projectRoot: string,
  manifestDir: string,
  sourcePath: string,
  globPattern: string | undefined,
  ignoreRules: CaptureIgnoreRules,
  artifactName: string,
): Promise<ResolvedArtifactFiles> {
  const absolutePath = resolvePathWithinProject(
    projectRoot,
    path.resolve(manifestDir, sourcePath),
    `Artifact ${artifactName}`,
  );
  await assertExistingPathWithinProject(projectRoot, absolutePath, `Artifact ${artifactName}`);
  const stat = await fs.stat(absolutePath);

  if (stat.isFile()) {
    if (globPattern !== undefined) {
      throw artifactCaptureError(
        artifactName,
        "A glob can only be used when the artifact path is a directory.",
      );
    }
    const relativePath = portableRelativePath(projectRoot, absolutePath);
    if (isProjectPathGitIgnored(relativePath, ignoreRules.gitIgnoreContexts)) {
      throw ignoredArtifactError(sourcePath);
    }
    const relativePattern = escape(portableRelativePath(projectRoot, absolutePath));
    const visible = await glob(relativePattern, {
      cwd: projectRoot,
      absolute: true,
      nodir: true,
      dot: false,
      follow: false,
      ignore: [...ignoreRules.globPatterns],
    });
    if (visible.length === 0) {
      throw ignoredArtifactError(sourcePath);
    }
    return { files: [absolutePath], collection: false, basePath: path.dirname(absolutePath) };
  }
  if (!stat.isDirectory()) {
    throw artifactCaptureError(
      artifactName,
      "The artifact path is not a regular file or directory.",
    );
  }

  const baseRelative = portableRelativePath(projectRoot, absolutePath);
  const pattern = [escape(baseRelative), globPattern ?? "**/*"].filter(Boolean).join("/");
  const matches: string[] = [];
  for await (const match of globIterate(pattern, {
    cwd: projectRoot,
    absolute: true,
    nodir: true,
    dot: false,
    follow: false,
    ignore: [...ignoreRules.globPatterns],
  })) {
    matches.push(match);
    if (matches.length > MAX_COLLECTION_FILES) {
      throw artifactCaptureError(
        artifactName,
        `The directory or glob matched more than ${MAX_COLLECTION_FILES} files.`,
      );
    }
  }
  const files = [
    ...new Set(
      matches
        .map((file) => path.resolve(file))
        .filter(
          (file) =>
            !isProjectPathGitIgnored(
              portableRelativePath(projectRoot, file),
              ignoreRules.gitIgnoreContexts,
            ),
        ),
    ),
  ].sort((left, right) =>
    portableProjectPath(projectRoot, left).localeCompare(portableProjectPath(projectRoot, right)),
  );
  if (files.length === 0) {
    throw artifactCaptureError(artifactName, "The directory or glob did not match any files.");
  }
  for (const file of files) {
    await assertExistingPathWithinProject(projectRoot, file, `Artifact ${artifactName}`);
  }
  return { files, collection: true, basePath: absolutePath };
}

function artifactKey(
  groupName: string,
  name: string,
  file: string,
  resolved: ResolvedArtifactFiles,
): string {
  if (!resolved.collection) {
    return `${groupName}/${name}`;
  }
  return `${groupName}/${name}/${portableRelativePath(resolved.basePath, file)}`;
}

function detectContentType(filePath: string, artifact: ArtifactBase): SnapshotContentType {
  if ((artifact as PromptArtifact).format === "json") {
    return "json";
  }
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".yaml" || extension === ".yml") {
    return "yaml";
  }
  return "text";
}

async function loadCaptureIgnoreRules(
  projectRoot: string,
  storagePath: string,
): Promise<CaptureIgnoreRules> {
  const patterns = [
    ".git/**",
    "**/.git/**",
    "node_modules/**",
    "**/node_modules/**",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    "secrets/**",
    "**/secrets/**",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
  ];
  const storageDir = resolvePathWithinProject(
    projectRoot,
    storagePath,
    "Snapshot storage path",
    false,
  );
  const storageRelative = portableRelativePath(projectRoot, storageDir);
  patterns.push(storageRelative, `${storageRelative}/**`, ".aidrift/**", "**/.aidrift/**");

  const globPatterns = [...new Set(patterns)];
  return {
    globPatterns,
    gitIgnoreContexts: await loadProjectGitIgnore(projectRoot, globPatterns),
  };
}

function ignoredArtifactError(sourcePath: string): AIDriftError {
  return new AIDriftError({
    code: "snapshot.artifact.ignored",
    exitCode: ExitCode.ConfigError,
    what: `Refusing to capture ignored or sensitive artifact: ${sourcePath}`,
    why: "The direct path is excluded by .gitignore or AIDRIFT's sensitive-file denylist.",
    fix: "Reference a non-sensitive tracked artifact and keep credentials in environment variables.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

async function collectGitMetadata(projectRoot: string): Promise<{
  readonly gitCommit?: string;
  readonly gitBranch?: string;
  readonly gitDirty?: boolean;
}> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const runGit = async (args: readonly string[]): Promise<string | undefined> => {
      try {
        const result = await execFileAsync("git", [...args], {
          cwd: projectRoot,
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
        });
        return result.stdout.trim();
      } catch {
        return undefined;
      }
    };
    const [gitCommit, gitBranch, status] = await Promise.all([
      runGit(["rev-parse", "--short", "HEAD"]),
      runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      runGit(["status", "--porcelain"]),
    ]);

    const metadata: { gitCommit?: string; gitBranch?: string; gitDirty?: boolean } = {};
    if (gitCommit !== undefined && gitCommit !== "") {
      metadata.gitCommit = gitCommit;
    }
    if (gitBranch !== undefined && gitBranch !== "") {
      metadata.gitBranch = gitBranch;
    }
    if (status !== undefined) {
      metadata.gitDirty = status.length > 0;
    }
    return metadata;
  } catch {
    return {};
  }
}

async function readManifest(manifestPath: string): Promise<string> {
  try {
    return (await readUtf8FileWithinLimit(manifestPath, MAX_MANIFEST_BYTES)).content;
  } catch (cause) {
    throw new AIDriftError({
      code: "snapshot.manifest.unreadable",
      exitCode: ExitCode.ConfigError,
      what: `Cannot read manifest while capturing snapshot: ${manifestPath}`,
      why: "The manifest was removed or became unreadable after validation.",
      fix: "Restore .aistate.yml and retry the snapshot.",
      docs: "https://github.com/Parth2412/aidrift#readme",
      cause,
    });
  }
}

function artifactCaptureError(artifactName: string, reason: string): AIDriftError {
  return new AIDriftError({
    code: "snapshot.artifact.invalid",
    exitCode: ExitCode.ConfigError,
    what: `Cannot capture artifact ${artifactName}.`,
    why: reason,
    fix: "Update the artifact path/glob to reference readable files inside the manifest project.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function portableRelativePath(root: string, target: string): string {
  return path.relative(path.resolve(root), path.resolve(target)).split(path.sep).join("/");
}

function sortedEntries<T>(record: Record<string, T> | undefined): readonly [string, T][] {
  return Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(sortedEntries(record));
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(stableJson(value)) as Record<string, unknown>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
