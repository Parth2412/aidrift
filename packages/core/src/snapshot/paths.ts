import fs from "node:fs/promises";
import path from "node:path";

import { AIDriftError, ExitCode } from "../errors.js";

const DOCS_URL = "https://github.com/Parth2412/aidrift#readme";

export function resolvePathWithinProject(
  projectRoot: string,
  configuredPath: string,
  purpose: string,
  allowProjectRoot = true,
): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, configuredPath);
  const relative = path.relative(root, resolved);

  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative) ||
    (!allowProjectRoot && relative.length === 0)
  ) {
    throw new AIDriftError({
      code: "path.outside_project",
      exitCode: ExitCode.ConfigError,
      what: `${purpose} must stay inside the manifest project root.`,
      why: `Resolved path ${resolved} is outside or equal to the disallowed project root ${root}.`,
      fix: "Use a relative path that resolves to a child of the directory containing .aistate.yml.",
      docs: DOCS_URL,
    });
  }

  return resolved;
}

export async function assertExistingPathWithinProject(
  projectRoot: string,
  targetPath: string,
  purpose: string,
): Promise<void> {
  const rootRealPath = await realpathOrConfigurationError(projectRoot, "manifest project root");
  const targetRealPath = await realpathOrConfigurationError(targetPath, purpose);
  assertRealPathContained(rootRealPath, targetRealPath, purpose);
}

export async function assertWritablePathWithinProject(
  projectRoot: string,
  targetPath: string,
  purpose: string,
): Promise<void> {
  const rootRealPath = await realpathOrConfigurationError(projectRoot, "manifest project root");
  let existingAncestor = path.resolve(targetPath);

  for (;;) {
    try {
      const ancestorRealPath = await fs.realpath(existingAncestor);
      assertRealPathContained(rootRealPath, ancestorRealPath, purpose);
      return;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw pathReadError(existingAncestor, purpose, error);
      }
      existingAncestor = parent;
    }
  }
}

export function portableProjectPath(projectRoot: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(absolutePath));
  const normalized = relative.split(path.sep).join("/");
  return normalized.length === 0 ? "." : `./${normalized}`;
}

function assertRealPathContained(
  rootRealPath: string,
  targetRealPath: string,
  purpose: string,
): void {
  const relative = path.relative(rootRealPath, targetRealPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AIDriftError({
      code: "path.symlink_escape",
      exitCode: ExitCode.ConfigError,
      what: `${purpose} resolves outside the manifest project root.`,
      why: "A path component or symbolic link escapes the project boundary.",
      fix: "Replace the path or symbolic link with a target inside the manifest project.",
      docs: DOCS_URL,
    });
  }
}

async function realpathOrConfigurationError(targetPath: string, purpose: string): Promise<string> {
  try {
    return await fs.realpath(targetPath);
  } catch (cause) {
    throw pathReadError(targetPath, purpose, cause);
  }
}

function pathReadError(targetPath: string, purpose: string, cause: unknown): AIDriftError {
  return new AIDriftError({
    code: "path.unreadable",
    exitCode: ExitCode.ConfigError,
    what: `Cannot resolve ${purpose}: ${targetPath}`,
    why: "The path does not exist, is inaccessible, or contains an invalid symbolic link.",
    fix: "Verify the configured path and filesystem permissions.",
    docs: DOCS_URL,
    cause,
  });
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
