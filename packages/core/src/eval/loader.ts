import fs from "node:fs/promises";
import path from "node:path";

import { AIDriftError, ExitCode } from "../errors.js";
import { parseEvalSuiteSource } from "./parser.js";
import type { Assertion, EvalSuite } from "./types.js";

export interface LoadEvalSuiteOptions {
  readonly suitePath: string;
}

export async function loadEvalSuite(options: LoadEvalSuiteOptions): Promise<EvalSuite> {
  const stat = await statIfExists(options.suitePath);
  if (stat === undefined) {
    return emptySuite(options.suitePath);
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(options.suitePath);
    const assertionFiles = entries
      .filter((entry) => /\.assertions\.ya?ml$/u.test(entry))
      .sort()
      .map((entry) => path.join(options.suitePath, entry));

    if (assertionFiles.length === 0) {
      return emptySuite(options.suitePath);
    }

    const suites = await Promise.all(
      assertionFiles.map(async (suitePath) => parseSuiteFile(suitePath)),
    );
    return combineSuites(options.suitePath, suites);
  }

  return parseSuiteFile(options.suitePath);
}

async function parseSuiteFile(suitePath: string): Promise<EvalSuite> {
  const source = await fs.readFile(suitePath, "utf8");
  const result = parseEvalSuiteSource({ suitePath, source });
  if (!result.valid || result.suite === undefined) {
    const firstError = result.errors[0];
    throw new AIDriftError({
      code: firstError?.code ?? "assertion.suite.invalid",
      exitCode: ExitCode.ConfigError,
      what: `Invalid assertion suite: ${suitePath}`,
      why: result.errors.map((error) => `[${error.code}] ${error.message}`).join("; "),
      fix: firstError?.fix ?? "Fix the assertion suite YAML before running aidrift plan.",
      docs: "../aidrift-docs/PHASES/09-eval-and-plan.md",
    });
  }

  return result.suite;
}

function combineSuites(suitePath: string, suites: readonly EvalSuite[]): EvalSuite {
  const assertions: Assertion[] = [];
  for (const suite of suites) {
    assertions.push(...suite.assertions);
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
  } catch {
    return undefined;
  }
}
