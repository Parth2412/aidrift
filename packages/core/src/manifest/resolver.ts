import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { glob } from "glob";
import { parseDocument } from "yaml";

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

const YAML_EXTENSIONS = new Set([".yml", ".yaml"]);

export async function resolveManifestPaths(options: ResolveManifestPathsOptions): Promise<{
  readonly resolvedPaths: readonly ResolvedManifestPath[];
  readonly errors: readonly ManifestValidationIssue[];
}> {
  const errors: ManifestValidationIssue[] = [];
  const resolvedPaths: ResolvedManifestPath[] = [];
  const manifestDir = path.dirname(path.resolve(options.manifestPath));

  const artifactEntries = collectPathArtifactEntries(options.manifest);

  for (const entry of artifactEntries) {
    const absolutePath = path.resolve(manifestDir, entry.sourcePath);

    if (!(await pathExists(absolutePath))) {
      errors.push(missingPathIssue(entry.manifestPath, entry.sourcePath, absolutePath));
      continue;
    }

    if (entry.globPattern === undefined) {
      const stats = await stat(absolutePath);
      resolvedPaths.push({
        manifestPath: entry.manifestPath,
        sourcePath: entry.sourcePath,
        absolutePath,
        kind: stats.isDirectory() ? "directory" : "file",
      });
      continue;
    }

    const matches = await glob(entry.globPattern, {
      cwd: absolutePath,
      absolute: true,
      nodir: true,
      ignore: [...(await loadGitignorePatterns(manifestDir))],
    });

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

    resolvedPaths.push({
      manifestPath: entry.manifestPath,
      sourcePath: entry.sourcePath,
      absolutePath,
      kind: "glob",
      matches,
    });
  }

  await validateEvalSuite(options.manifest.eval.suite, manifestDir, errors, resolvedPaths);

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
  errors: ManifestValidationIssue[],
  resolvedPaths: ResolvedManifestPath[],
): Promise<void> {
  const absolutePath = path.resolve(manifestDir, suitePath);

  if (!(await pathExists(absolutePath))) {
    errors.push(missingPathIssue("eval.suite", suitePath, absolutePath));
    return;
  }

  const stats = await stat(absolutePath);
  resolvedPaths.push({
    manifestPath: "eval.suite",
    sourcePath: suitePath,
    absolutePath,
    kind: stats.isDirectory() ? "directory" : "file",
  });

  const files = stats.isDirectory()
    ? await glob("**/*.{yml,yaml}", { cwd: absolutePath, absolute: true, nodir: true })
    : YAML_EXTENSIONS.has(path.extname(absolutePath))
      ? [absolutePath]
      : [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const document = parseDocument(source, { prettyErrors: false });

    if (document.errors.length > 0) {
      const firstError = document.errors[0];
      errors.push({
        severity: "error",
        code: "manifest.eval.invalid",
        message: `Eval assertion file is not valid YAML: ${path.relative(manifestDir, file)}.`,
        manifestPath: "eval.suite",
        line: firstError?.linePos?.[0]?.line,
        column: firstError?.linePos?.[0]?.col,
        fix: "Fix the YAML syntax in the eval assertion file.",
      });
    }
  }
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

async function loadGitignorePatterns(manifestDir: string): Promise<readonly string[]> {
  const gitignorePath = path.join(manifestDir, ".gitignore");

  if (!(await pathExists(gitignorePath))) {
    return [];
  }

  const source = await readFile(gitignorePath, "utf8");
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
