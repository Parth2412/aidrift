import fs from "node:fs/promises";
import path from "node:path";

import { AIDriftError, ExitCode } from "../errors.js";
import { BoundedFileReadError, readUtf8FileWithinLimit } from "../files/bounded-read.js";
import {
  isProjectPathGitIgnored,
  loadProjectGitIgnore,
  portablePath,
  type GitIgnoreContext,
} from "../files/gitignore.js";
import { assertExistingPathWithinProject } from "../snapshot/paths.js";
import { parseEvalSuiteSource } from "./parser.js";
import type { Assertion, EvalSuite } from "./types.js";

const MAX_ASSERTION_FILES = 100;
const MAX_ASSERTION_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ASSERTION_SUITE_BYTES = 10 * 1024 * 1024;
const MAX_ASSERTIONS = 10_000;
const MAX_SUITE_DIRECTORY_ENTRIES = 10_000;
const EVAL_IGNORE_TRAVERSAL = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.aidrift/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
];

export interface LoadEvalSuiteOptions {
  readonly suitePath: string;
  readonly projectRoot?: string | undefined;
  readonly gitIgnoreContexts?: readonly GitIgnoreContext[] | undefined;
}

export async function loadEvalSuite(options: LoadEvalSuiteOptions): Promise<EvalSuite> {
  const projectRoot =
    options.projectRoot === undefined ? undefined : path.resolve(options.projectRoot);
  const ignoreContexts =
    options.gitIgnoreContexts ??
    (projectRoot === undefined
      ? []
      : await loadProjectGitIgnore(projectRoot, EVAL_IGNORE_TRAVERSAL));
  if (projectRoot !== undefined) {
    await assertExistingPathWithinProject(projectRoot, options.suitePath, "Eval suite path");
    assertNotIgnored(options.suitePath, projectRoot, ignoreContexts);
  }
  const stat = await statIfExists(options.suitePath);
  if (stat === undefined) {
    return emptySuite(options.suitePath);
  }

  if (stat.isDirectory()) {
    const assertionFiles = await listAssertionFiles(options.suitePath);

    if (assertionFiles.length === 0) {
      return emptySuite(options.suitePath);
    }

    const suites: EvalSuite[] = [];
    let assertionCount = 0;
    let totalBytes = 0;
    for (const suitePath of assertionFiles) {
      if (projectRoot !== undefined) {
        await assertExistingPathWithinProject(projectRoot, suitePath, "Eval assertion file");
        if (isIgnored(suitePath, projectRoot, ignoreContexts)) continue;
      }
      const loaded = await parseSuiteFile(suitePath);
      const suite = loaded.suite;
      totalBytes += loaded.sizeBytes;
      if (totalBytes > MAX_ASSERTION_SUITE_BYTES) {
        throw suiteLoadError(
          options.suitePath,
          `The assertion suite exceeds the ${MAX_ASSERTION_SUITE_BYTES}-byte total limit.`,
        );
      }
      assertionCount += suite.assertions.length;
      if (assertionCount > MAX_ASSERTIONS) {
        throw suiteLoadError(
          options.suitePath,
          `The suite contains more than ${MAX_ASSERTIONS} assertions.`,
        );
      }
      suites.push(suite);
    }
    return combineSuites(options.suitePath, suites);
  }

  return (await parseSuiteFile(options.suitePath)).suite;
}

async function listAssertionFiles(suitePath: string): Promise<readonly string[]> {
  const assertionFiles: string[] = [];
  let entryCount = 0;
  const directory = await fs.opendir(suitePath);
  for await (const entry of directory) {
    entryCount += 1;
    if (entryCount > MAX_SUITE_DIRECTORY_ENTRIES) {
      throw suiteLoadError(
        suitePath,
        `The suite directory contains more than ${MAX_SUITE_DIRECTORY_ENTRIES} entries.`,
      );
    }
    if (/\.assertions\.ya?ml$/u.test(entry.name)) {
      assertionFiles.push(path.join(suitePath, entry.name));
      if (assertionFiles.length > MAX_ASSERTION_FILES) {
        throw suiteLoadError(
          suitePath,
          `The suite contains more than ${MAX_ASSERTION_FILES} assertion files.`,
        );
      }
    }
  }
  return assertionFiles.sort();
}

async function parseSuiteFile(
  suitePath: string,
): Promise<{ readonly suite: EvalSuite; readonly sizeBytes: number }> {
  let loaded;
  try {
    loaded = await readUtf8FileWithinLimit(suitePath, MAX_ASSERTION_FILE_BYTES);
  } catch (cause) {
    if (cause instanceof BoundedFileReadError) {
      throw suiteLoadError(suitePath, cause.message, cause);
    }
    throw suiteLoadError(suitePath, "The assertion file cannot be read.", cause);
  }
  const result = parseEvalSuiteSource({ suitePath, source: loaded.content });
  if (!result.valid || result.suite === undefined) {
    const firstError = result.errors[0];
    throw new AIDriftError({
      code: firstError?.code ?? "assertion.suite.invalid",
      exitCode: ExitCode.ConfigError,
      what: `Invalid assertion suite: ${suitePath}`,
      why: result.errors.map((error) => `[${error.code}] ${error.message}`).join("; "),
      fix: firstError?.fix ?? "Fix the assertion suite YAML before running aidrift plan.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }
  if (result.suite.assertions.length > MAX_ASSERTIONS) {
    throw suiteLoadError(
      suitePath,
      `The suite contains ${result.suite.assertions.length} assertions; the limit is ${MAX_ASSERTIONS}.`,
    );
  }

  return { suite: result.suite, sizeBytes: loaded.sizeBytes };
}

function assertNotIgnored(
  filePath: string,
  projectRoot: string,
  contexts: readonly GitIgnoreContext[],
): void {
  if (isIgnored(filePath, projectRoot, contexts)) {
    throw suiteLoadError(filePath, "The configured eval suite is excluded by .gitignore.");
  }
}

function isIgnored(
  filePath: string,
  projectRoot: string,
  contexts: readonly GitIgnoreContext[],
): boolean {
  return isProjectPathGitIgnored(portablePath(path.relative(projectRoot, filePath)), contexts);
}

function combineSuites(suitePath: string, suites: readonly EvalSuite[]): EvalSuite {
  const assertions: Assertion[] = [];
  for (const suite of suites) {
    assertions.push(...suite.assertions);
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const assertion of assertions) {
    if (seen.has(assertion.id)) duplicates.add(assertion.id);
    seen.add(assertion.id);
  }
  if (duplicates.size > 0) {
    throw new AIDriftError({
      code: "assertion.id.duplicate",
      exitCode: ExitCode.ConfigError,
      what: `Duplicate assertion ids in suite directory: ${[...duplicates].sort().join(", ")}.`,
      why: "Assertion ids must be unique across every file loaded from one eval suite.",
      fix: "Rename duplicate assertions so baselines and results have one unambiguous identity.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
  }

  return {
    suite: path.basename(suitePath),
    sourcePath: suitePath,
    assertions,
  };
}

function emptySuite(suitePath: string): EvalSuite {
  return {
    suite: path.basename(suitePath),
    sourcePath: suitePath,
    assertions: [],
  };
}

async function statIfExists(
  targetPath: string,
): Promise<Awaited<ReturnType<typeof fs.stat>> | undefined> {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw suiteLoadError(targetPath, "The suite path exists but cannot be read.", error);
  }
}

function suiteLoadError(suitePath: string, reason: string, cause?: unknown): AIDriftError {
  return new AIDriftError({
    code: "assertion.suite.unreadable",
    exitCode: ExitCode.ConfigError,
    what: `Cannot safely load assertion suite: ${suitePath}`,
    why: reason,
    fix: "Use a readable suite containing at most 100 files, 10,000 assertions, and 2 MiB per file.",
    docs: "https://github.com/Parth2412/aidrift#readme",
    cause,
  });
}
