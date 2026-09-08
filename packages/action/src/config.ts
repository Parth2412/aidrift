import type { ActionInputs, CoreAdapter } from "./types.js";

const PROBE_CATEGORIES = new Set([
  "deterministic",
  "structural",
  "semantic",
  "behavioral",
  "performance",
]);

export function readActionInputs(core: CoreAdapter): ActionInputs {
  const manifest = optionalInput(core, "manifest") ?? ".aistate.yml";
  const failOn = enumInput(core, "fail-on", ["fail", "warn"] as const, "fail");
  const commentMode = enumInput(core, "comment-mode", ["upsert", "new", "none"] as const, "upsert");
  const probeCategory = optionalInput(core, "probe-category");
  if (probeCategory !== undefined && !PROBE_CATEGORIES.has(probeCategory)) {
    throw new Error(
      "Input probe-category must be deterministic, structural, semantic, behavioral, or performance.",
    );
  }
  const uploadArtifact = booleanInput(core, "upload-artifact", true);
  const artifactName = optionalInput(core, "artifact-name") ?? "aidrift-results";
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(artifactName)) {
    throw new Error(
      "Input artifact-name must use 1-128 letters, numbers, dots, underscores, or dashes.",
    );
  }
  const retentionDays = positiveIntegerInput(core, "retention-days", 7, 90);
  const githubToken = optionalInput(core, "github-token");
  if (githubToken !== undefined) core.setSecret(githubToken);

  return {
    manifest,
    failOn,
    commentMode,
    probeCategory,
    uploadArtifact,
    artifactName,
    retentionDays,
    baseline: optionalInput(core, "baseline"),
    assertions: optionalInput(core, "assertions"),
    tags: optionalInput(core, "tags"),
    samples: validatedPositiveInteger(core, "samples", 100),
    probeModel: optionalInput(core, "probe-model"),
    concurrency: validatedPositiveInteger(core, "concurrency", 32),
    timeout: validatedPositiveInteger(core, "timeout", 3_600),
    costBudget: validatedNonNegativeNumber(core, "cost-budget"),
    githubToken,
  };
}

export function buildCheckArguments(inputs: ActionInputs): readonly string[] {
  const args = [
    "--config",
    inputs.manifest,
    "check",
    "--format",
    "json",
    "--fail-on",
    inputs.failOn,
  ];
  appendValue(args, "--baseline", inputs.baseline);
  appendValue(args, "--assertions", inputs.assertions);
  appendValue(args, "--tags", inputs.tags);
  appendValue(args, "--samples", inputs.samples);
  appendValue(args, "--probe-model", inputs.probeModel);
  appendValue(args, "--probe-category", inputs.probeCategory);
  appendValue(args, "--concurrency", inputs.concurrency);
  appendValue(args, "--timeout", inputs.timeout);
  appendValue(args, "--cost-budget", inputs.costBudget);
  return args;
}

function appendValue(target: string[], flag: string, value: string | undefined): void {
  if (value !== undefined) target.push(flag, value);
}

function optionalInput(core: CoreAdapter, name: string): string | undefined {
  const value = core.getInput(name).trim();
  return value.length === 0 ? undefined : value;
}

function enumInput<const T extends readonly string[]>(
  core: CoreAdapter,
  name: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const value = optionalInput(core, name) ?? fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T[number];
  throw new Error(`Input ${name} must be one of: ${allowed.join(", ")}.`);
}

function booleanInput(core: CoreAdapter, name: string, fallback: boolean): boolean {
  const value = optionalInput(core, name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Input ${name} must be true or false.`);
}

function positiveIntegerInput(
  core: CoreAdapter,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = optionalInput(core, name);
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`Input ${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Input ${name} must be between 1 and ${maximum}.`);
  }
  return parsed;
}

function validatedPositiveInteger(
  core: CoreAdapter,
  name: string,
  maximum: number,
): string | undefined {
  const value = optionalInput(core, name);
  if (value === undefined) return undefined;
  if (
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > maximum
  ) {
    throw new Error(`Input ${name} must be between 1 and ${maximum}.`);
  }
  return value;
}

function validatedNonNegativeNumber(core: CoreAdapter, name: string): string | undefined {
  const value = optionalInput(core, name);
  if (value === undefined) return undefined;
  if (!/^\d+(?:\.\d+)?$/u.test(value) || !Number.isFinite(Number(value))) {
    throw new Error(`Input ${name} must be a finite non-negative USD amount.`);
  }
  return value;
}
