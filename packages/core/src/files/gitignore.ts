import fs from "node:fs/promises";
import path from "node:path";

import { globIterate } from "glob";
import ignore, { type Ignore } from "ignore";

import { AIDriftError, ExitCode } from "../errors.js";
import { BoundedFileReadError, readUtf8FileWithinLimit } from "./bounded-read.js";

export interface GitIgnoreContext {
  readonly base: string;
  readonly matcher: Ignore;
}

const MAX_GITIGNORE_FILES = 1_000;
const MAX_GITIGNORE_FILE_BYTES = 1024 * 1024;
const MAX_GITIGNORE_TOTAL_BYTES = 8 * 1024 * 1024;

export async function loadProjectGitIgnore(
  root: string,
  traversalIgnore: readonly string[],
): Promise<readonly GitIgnoreContext[]> {
  const filenames: string[] = [];
  for await (const filename of globIterate("**/.gitignore", {
    cwd: root,
    absolute: true,
    dot: true,
    nodir: true,
    follow: false,
    ignore: [...traversalIgnore],
  })) {
    filenames.push(filename);
    if (filenames.length > MAX_GITIGNORE_FILES) {
      throw gitIgnoreError(
        `The project contains more than ${MAX_GITIGNORE_FILES} .gitignore files.`,
      );
    }
  }
  filenames.sort((left, right) => {
    const leftRelative = portablePath(path.relative(root, left));
    const rightRelative = portablePath(path.relative(root, right));
    return (
      pathDepth(leftRelative) - pathDepth(rightRelative) ||
      leftRelative.localeCompare(rightRelative)
    );
  });

  const realRoot = await fs.realpath(root);
  const contexts: GitIgnoreContext[] = [];
  let totalBytes = 0;
  for (const filename of filenames) {
    const relativeFilename = portablePath(path.relative(root, filename));
    if (isProjectPathGitIgnored(relativeFilename, contexts)) continue;

    const stats = await fs.lstat(filename);
    if (!stats.isFile()) continue;
    if (stats.size > MAX_GITIGNORE_FILE_BYTES) {
      throw gitIgnoreError(
        `${relativeFilename} exceeds the ${MAX_GITIGNORE_FILE_BYTES}-byte .gitignore limit.`,
      );
    }
    let source;
    try {
      source = await readUtf8FileWithinLimit(filename, MAX_GITIGNORE_FILE_BYTES);
    } catch (error) {
      if (error instanceof BoundedFileReadError) {
        throw gitIgnoreError(error.message);
      }
      throw error;
    }
    totalBytes += source.sizeBytes;
    if (totalBytes > MAX_GITIGNORE_TOTAL_BYTES) {
      throw gitIgnoreError(
        `Combined .gitignore content exceeds the ${MAX_GITIGNORE_TOTAL_BYTES}-byte limit.`,
      );
    }

    const realFilename = await fs.realpath(filename);
    if (!isPathInside(realRoot, realFilename)) {
      throw gitIgnoreError(`${relativeFilename} resolves outside the project root.`);
    }
    contexts.push({
      base: portablePath(path.relative(root, path.dirname(filename))),
      matcher: ignore().add(source.content),
    });
  }
  return contexts;
}

export function isProjectPathGitIgnored(
  relativePath: string,
  contexts: readonly GitIgnoreContext[],
): boolean {
  const normalizedPath = portablePath(relativePath);
  let ignored = false;
  for (const context of contexts) {
    const scopedPath = pathWithinBase(normalizedPath, context.base);
    if (scopedPath === undefined || scopedPath.length === 0) continue;
    const result = context.matcher.test(scopedPath);
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  return ignored;
}

export function portablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function pathWithinBase(relativePath: string, base: string): string | undefined {
  if (base.length === 0) return relativePath;
  if (relativePath === base) return "";
  return relativePath.startsWith(`${base}/`) ? relativePath.slice(base.length + 1) : undefined;
}

function pathDepth(value: string): number {
  return value.length === 0 ? 0 : value.split("/").length;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function gitIgnoreError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "project.gitignore.unsafe",
    exitCode: ExitCode.ConfigError,
    what: "Project ignore rules cannot be loaded safely.",
    why: reason,
    fix: "Reduce or replace the project .gitignore files and retry.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}
