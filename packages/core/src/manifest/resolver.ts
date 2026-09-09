import { access, stat } from "node:fs/promises";
import path from "node:path";

import { globIterate } from "glob";

import { AIDriftError } from "../errors.js";
import { loadEvalSuite } from "../eval/loader.js";
import {
  isProjectPathGitIgnored,
  loadProjectGitIgnore,
  portablePath,
  type GitIgnoreContext,
} from "../files/gitignore.js";
import {
  assertExistingPathWithinProject,
  assertWritablePathWithinProject,
  resolvePathWithinProject,
} from "../snapshot/paths.js";
import type {
  AIStateManifest,
  ArtifactBase,
  ManifestValidationIssue,
  ResolvedManifestPath,
} from "./types.js";

export interface ResolveManifestPathsOptions {
  readonly manifest: AIStateManifest;
  readonly manifestPath: string;
}

const MANIFEST_GLOB_IGNORE = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.aidrift/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
];
const MAX_MANIFEST_GLOB_MATCHES = 10_000;

export async function resolveManifestPaths(options: ResolveManifestPathsOptions): Promise<{
  readonly resolvedPaths: readonly ResolvedManifestPath[];
  readonly errors: readonly ManifestValidationIssue[];
}> {
  const errors: ManifestValidationIssue[] = [];
  const resolvedPaths: ResolvedManifestPath[] = [];
  const manifestDir = path.dirname(path.resolve(options.manifestPath));
  let gitIgnoreContexts: readonly GitIgnoreContext[];
  try {
    gitIgnoreContexts = await loadProjectGitIgnore(manifestDir, MANIFEST_GLOB_IGNORE);
  } catch (error) {
    errors.push(pathSafetyIssue(error, ".gitignore"));
    return { errors, resolvedPaths };
  }

  const artifactEntries = collectPathArtifactEntries(options.manifest);

  for (const entry of artifactEntries) {
    const absolutePath = resolveValidationPath(
      manifestDir,
      entry.sourcePath,
      entry.manifestPath,
      errors,
    );
    if (absolutePath === undefined) continue;

    if (!(await pathExists(absolutePath))) {
      errors.push(missingPathIssue(entry.manifestPath, entry.sourcePath, absolutePath));
      continue;
    }
    if (
      !(await validateExistingContainedPath(manifestDir, absolutePath, entry.manifestPath, errors))
    ) {
      continue;
    }

    if (entry.globPattern === undefined) {
      const stats = await stat(absolutePath);
      if (
        stats.isFile() &&
        isProjectPathGitIgnored(
          portablePath(path.relative(manifestDir, absolutePath)),
          gitIgnoreContexts,
        )
      ) {
        errors.push(ignoredPathIssue(entry.manifestPath, entry.sourcePath));
        continue;
      }
      resolvedPaths.push({
        manifestPath: entry.manifestPath,
        sourcePath: entry.sourcePath,
        absolutePath,
        kind: stats.isDirectory() ? "directory" : "file",
      });
      continue;
    }

    const matches: string[] = [];
    let scannedMatches = 0;
    for await (const match of globIterate(entry.globPattern, {
      cwd: absolutePath,
      absolute: true,
      nodir: true,
      follow: false,
      ignore: MANIFEST_GLOB_IGNORE,
    })) {
      scannedMatches += 1;
      if (scannedMatches > MAX_MANIFEST_GLOB_MATCHES) {
        errors.push({
          severity: "error",
          code: "manifest.glob.limit_exceeded",
          message: `Glob "${entry.globPattern}" matched more than ${MAX_MANIFEST_GLOB_MATCHES} files under "${entry.sourcePath}".`,
          manifestPath: `${entry.manifestPath.replace(/\.path$/u, "")}.glob`,
          fix: "Narrow the artifact glob or add generated files to .gitignore.",
        });
        break;
      }
      if (
        !isProjectPathGitIgnored(portablePath(path.relative(manifestDir, match)), gitIgnoreContexts)
      ) {
        matches.push(match);
      }
    }
    if (scannedMatches > MAX_MANIFEST_GLOB_MATCHES) continue;

    if (matches.length === 0) {
      errors.push({
        severity: "error",
        code: "manifest.glob.empty",
        message: `Glob "${entry.globPattern}" did not match any files under "${entry.sourcePath}".`,
        manifestPath: `${entry.manifestPath.replace(/\.path$/u, "")}.glob`,
        fix: "Update the glob or artifact path so at least one file is matched.",
      });
      continue;
    }
    let containsUnsafeMatch = false;
    for (const match of matches) {
      if (!(await validateExistingContainedPath(manifestDir, match, entry.manifestPath, errors))) {
        containsUnsafeMatch = true;
      }
    }
    if (containsUnsafeMatch) continue;

    resolvedPaths.push({
      manifestPath: entry.manifestPath,
      sourcePath: entry.sourcePath,
      absolutePath,
      kind: "glob",
      matches,
    });
  }

  await validateEvalSuite(
    options.manifest.eval.suite,
    manifestDir,
    gitIgnoreContexts,
    errors,
    resolvedPaths,
  );
  await validateStoragePath(options.manifest.storage.path, manifestDir, errors);

  return { errors, resolvedPaths };
}

interface PathArtifactEntry {
  readonly manifestPath: string;
  readonly sourcePath: string;
  readonly globPattern?: string | undefined;
}

function collectPathArtifactEntries(manifest: AIStateManifest): readonly PathArtifactEntry[] {
  const entries: PathArtifactEntry[] = [];
  const groups = manifest.artifacts;

  collectGroup(entries, "artifacts.prompts", groups.prompts);
  collectGroup(entries, "artifacts.rag", groups.rag);
  collectGroup(entries, "artifacts.tools", groups.tools);
  collectGroup(entries, "artifacts.safety", groups.safety);
  collectGroup(entries, "artifacts.adapters", groups.adapters);
  collectGroup(entries, "artifacts.custom", groups.custom);

  return entries;
}

function collectGroup(
  entries: PathArtifactEntry[],
  groupPath: string,
  group: Record<string, ArtifactBase> | undefined,
): void {
  if (group === undefined) {
    return;
  }

  Object.entries(group).forEach(([name, artifact]) => {
    if (artifact.path === undefined) {
      return;
    }

    entries.push({
      manifestPath: `${groupPath}.${name}.path`,
      sourcePath: artifact.path,
      globPattern: artifact.glob,
    });
  });
}

async function validateEvalSuite(
  suitePath: string,
  manifestDir: string,
  gitIgnoreContexts: readonly GitIgnoreContext[],
  errors: ManifestValidationIssue[],
  resolvedPaths: ResolvedManifestPath[],
): Promise<void> {
  const absolutePath = resolveValidationPath(manifestDir, suitePath, "eval.suite", errors);
  if (absolutePath === undefined) return;

  if (!(await pathExists(absolutePath))) {
    errors.push(missingPathIssue("eval.suite", suitePath, absolutePath));
    return;
  }
  if (!(await validateExistingContainedPath(manifestDir, absolutePath, "eval.suite", errors))) {
    return;
  }

  const stats = await stat(absolutePath);
  resolvedPaths.push({
    manifestPath: "eval.suite",
    sourcePath: suitePath,
    absolutePath,
    kind: stats.isDirectory() ? "directory" : "file",
  });

  try {
    await loadEvalSuite({
      suitePath: absolutePath,
      projectRoot: manifestDir,
      gitIgnoreContexts,
    });
  } catch (error) {
    errors.push(evalSuiteIssue(error));
  }
}

function evalSuiteIssue(error: unknown): ManifestValidationIssue {
  if (error instanceof AIDriftError) {
    return {
      severity: "error",
      code: error.code,
      message: `${error.what} ${error.why}`,
      manifestPath: "eval.suite",
      fix: error.fix,
    };
  }
  return {
    severity: "error",
    code: "manifest.eval.invalid",
    message: "The eval assertion suite cannot be loaded.",
    manifestPath: "eval.suite",
    fix: "Fix the assertion suite before running AIDRIFT commands.",
  };
}

async function validateStoragePath(
  storagePath: string,
  manifestDir: string,
  errors: ManifestValidationIssue[],
): Promise<void> {
  let absolutePath: string;
  try {
    absolutePath = resolvePathWithinProject(
      manifestDir,
      storagePath,
      "Snapshot storage path",
      false,
    );
    await assertWritablePathWithinProject(manifestDir, absolutePath, "Snapshot storage path");
  } catch (error) {
    errors.push(pathSafetyIssue(error, "storage.path"));
  }
}

function resolveValidationPath(
  manifestDir: string,
  sourcePath: string,
  manifestPath: string,
  errors: ManifestValidationIssue[],
): string | undefined {
  try {
    return resolvePathWithinProject(manifestDir, sourcePath, manifestPath);
  } catch (error) {
    errors.push(pathSafetyIssue(error, manifestPath));
    return undefined;
  }
}

async function validateExistingContainedPath(
  manifestDir: string,
  absolutePath: string,
  manifestPath: string,
  errors: ManifestValidationIssue[],
): Promise<boolean> {
  try {
    await assertExistingPathWithinProject(manifestDir, absolutePath, manifestPath);
    return true;
  } catch (error) {
    errors.push(pathSafetyIssue(error, manifestPath));
    return false;
  }
}

function pathSafetyIssue(error: unknown, manifestPath: string): ManifestValidationIssue {
  if (error instanceof AIDriftError) {
    return {
      severity: "error",
      code: error.code,
      message: `${error.what} ${error.why}`,
      manifestPath,
      fix: error.fix,
    };
  }
  return {
    severity: "error",
    code: "manifest.path.unreadable",
    message: `Cannot safely resolve ${manifestPath}.`,
    manifestPath,
    fix: "Use a readable path contained within the manifest project.",
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function missingPathIssue(
  manifestPath: string,
  sourcePath: string,
  absolutePath: string,
): ManifestValidationIssue {
  return {
    severity: "error",
    code: "manifest.path.missing",
    message: `Referenced path "${sourcePath}" does not exist.`,
    manifestPath,
    fix: `Create the file/directory or update the manifest path. Resolved path: ${absolutePath}`,
  };
}

function ignoredPathIssue(manifestPath: string, sourcePath: string): ManifestValidationIssue {
  return {
    severity: "error",
    code: "manifest.path.ignored",
    message: `Referenced path "${sourcePath}" is excluded by .gitignore.`,
    manifestPath,
    fix: "Reference a tracked non-sensitive artifact or update the project's ignore rules.",
  };
}
