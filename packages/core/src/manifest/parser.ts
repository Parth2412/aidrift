import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import { AIDriftError } from "../errors.js";
import { BoundedFileReadError, readUtf8FileWithinLimit } from "../files/bounded-read.js";
import { structuredValueLimitViolation } from "../files/structured-value.js";
import { resolveManifestPaths } from "./resolver.js";
import { AI_STATE_MANIFEST_SCHEMA } from "./schema.js";
import { findManifestSecrets } from "./security.js";
import {
  RECOGNIZED_MODEL_PROVIDERS,
  type AIStateManifest,
  type ManifestValidationIssue,
  type ManifestValidationResult,
  type ValidateManifestFileOptions,
  type ValidateManifestSourceOptions,
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validateSchema = ajv.compile(AI_STATE_MANIFEST_SCHEMA);
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

export async function validateManifestFile(
  options: ValidateManifestFileOptions,
): Promise<ManifestValidationResult> {
  let source: string;
  try {
    source = (await readUtf8FileWithinLimit(options.manifestPath, MAX_MANIFEST_BYTES)).content;
  } catch (error) {
    if (error instanceof BoundedFileReadError) {
      return manifestFileError(
        options.manifestPath,
        error.failure === "too_large" ? "manifest.file.too_large" : "manifest.file.invalid",
        error.failure === "too_large"
          ? `larger than the ${MAX_MANIFEST_BYTES}-byte limit`
          : "not a regular file",
      );
    }
    return {
      valid: false,
      manifestPath: options.manifestPath,
      errors: [
        {
          severity: "error",
          code: "manifest.file.missing",
          message: `manifest file does not exist or cannot be read: ${options.manifestPath}`,
          fix: "Create .aistate.yml or pass --config with the correct manifest path.",
        },
      ],
      warnings: [],
      resolvedPaths: [],
    };
  }

  try {
    return await validateManifestSource({ ...options, source });
  } catch (error) {
    const issue =
      error instanceof AIDriftError
        ? {
            severity: "error" as const,
            code: error.code,
            message: `${error.what} ${error.why}`,
            fix: error.fix,
          }
        : {
            severity: "error" as const,
            code: "manifest.validation.failed",
            message: "Manifest validation could not complete safely.",
            fix: "Check referenced project files and retry validation.",
          };
    return {
      valid: false,
      manifestPath: options.manifestPath,
      errors: [issue],
      warnings: [],
      resolvedPaths: [],
    };
  }
}

function manifestFileError(
  manifestPath: string,
  code: string,
  reason: string,
): ManifestValidationResult {
  return {
    valid: false,
    manifestPath,
    errors: [
      {
        severity: "error",
        code,
        message: `manifest file is ${reason}: ${manifestPath}`,
        fix: "Use a readable regular .aistate.yml file no larger than 2 MiB.",
      },
    ],
    warnings: [],
    resolvedPaths: [],
  };
}

export async function validateManifestSource(
  options: ValidateManifestSourceOptions,
): Promise<ManifestValidationResult> {
  if (Buffer.byteLength(options.source, "utf8") > MAX_MANIFEST_BYTES) {
    return manifestFileError(
      options.manifestPath,
      "manifest.file.too_large",
      `larger than the ${MAX_MANIFEST_BYTES}-byte limit`,
    );
  }
  const errors: ManifestValidationIssue[] = [];
  const warnings: ManifestValidationIssue[] = [];
  const document = parseDocument(options.source, { prettyErrors: false });

  if (document.errors.length > 0) {
    return {
      valid: false,
      manifestPath: options.manifestPath,
      errors: document.errors.map((error) => ({
        severity: "error",
        code: "manifest.yaml.invalid",
        message: error.message,
        line: getYamlErrorLocation(options.source, error).line,
        column: getYamlErrorLocation(options.source, error).column,
        fix: "Fix YAML syntax before running AIDRIFT commands.",
      })),
      warnings: [],
      resolvedPaths: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = document.toJS({ mapAsMap: false, maxAliasCount: 100 }) as unknown;
  } catch (error) {
    return {
      valid: false,
      manifestPath: options.manifestPath,
      errors: [
        {
          severity: "error",
          code: "manifest.yaml.invalid",
          message:
            error instanceof Error ? error.message : "Manifest YAML could not be expanded safely.",
          fix: "Remove excessive YAML aliases and use explicit bounded manifest values.",
        },
      ],
      warnings: [],
      resolvedPaths: [],
    };
  }

  const complexityViolation = structuredValueLimitViolation(parsed, {
    maximumNodes: 100_000,
    maximumDepth: 64,
    maximumCollectionEntries: 10_000,
  });
  if (complexityViolation !== undefined) {
    return {
      valid: false,
      manifestPath: options.manifestPath,
      errors: [
        {
          severity: "error",
          code: "manifest.complexity.exceeded",
          message: complexityViolation,
          fix: "Flatten or split the manifest so it stays within documented structural limits.",
        },
      ],
      warnings: [],
      resolvedPaths: [],
    };
  }

  errors.push(...findManifestSecrets(parsed));

  if (!validateSchema(parsed)) {
    errors.push(...formatSchemaErrors(validateSchema.errors ?? []));
  }

  if (errors.length > 0) {
    return resultFromIssues(options, undefined, errors, warnings, []);
  }

  const manifest = parsed as AIStateManifest;
  const semanticIssues = [
    ...validateModelArtifacts(manifest),
    ...validateEvalTargetArtifacts(manifest),
  ];
  errors.push(...semanticIssues.filter((issue) => issue.severity === "error"));
  warnings.push(...semanticIssues.filter((issue) => issue.severity === "warning"));

  const resolved = await resolveManifestPaths({ manifest, manifestPath: options.manifestPath });
  errors.push(...resolved.errors);

  const strictErrors = options.strict === true ? warnings : [];

  return resultFromIssues(
    options,
    manifest,
    [...errors, ...strictErrors],
    warnings,
    resolved.resolvedPaths,
  );
}

function getYamlErrorLocation(
  source: string,
  error: {
    readonly linePos?: readonly { readonly line: number; readonly col: number }[];
    readonly pos?: readonly number[];
  },
): { readonly line: number | undefined; readonly column: number | undefined } {
  const linePos = error.linePos?.[0];
  if (linePos !== undefined) {
    return { line: linePos.line, column: linePos.col };
  }

  const offset = error.pos?.[0];
  if (offset === undefined) {
    return { line: undefined, column: undefined };
  }

  const normalizedOffset =
    offset > 0 && (source[offset - 1] === "\n" || source[offset - 1] === "\r")
      ? offset - 1
      : offset;
  const before = source.slice(0, normalizedOffset);
  const lines = before.split(/\r?\n/u);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function validateModelArtifacts(manifest: AIStateManifest): readonly ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];

  Object.entries(manifest.artifacts.models ?? {}).forEach(([name, model]) => {
    if (
      !RECOGNIZED_MODEL_PROVIDERS.includes(
        model.provider as (typeof RECOGNIZED_MODEL_PROVIDERS)[number],
      )
    ) {
      issues.push({
        severity: "error",
        code: "manifest.provider.unknown",
        message: `Unknown model provider "${model.provider}".`,
        manifestPath: `artifacts.models.${name}.provider`,
        fix: `Use one of: ${RECOGNIZED_MODEL_PROVIDERS.join(", ")}.`,
      });
    }

    if (!isPinnedModelName(model.model)) {
      issues.push({
        severity: "warning",
        code: "manifest.model.unpinned",
        message: `Model "${model.model}" does not look pinned to a dated or versioned release.`,
        manifestPath: `artifacts.models.${name}.model`,
        fix: "Use a dated or canonical versioned model ID instead of a rolling alias.",
      });
    }
  });

  return issues;
}

function validateEvalTargetArtifacts(
  manifest: AIStateManifest,
): readonly ManifestValidationIssue[] {
  const target = manifest.eval.target;
  if (target?.type !== "provider") {
    return [];
  }

  const issues: ManifestValidationIssue[] = [];
  const modelNames = Object.keys(manifest.artifacts.models ?? {});
  if (!modelNames.includes(target.model)) {
    issues.push({
      severity: "error",
      code: "manifest.eval.target.model_unknown",
      message: `Eval target references unknown model artifact "${target.model}".`,
      manifestPath: "eval.target.model",
      fix: "Reference a key declared under artifacts.models.",
    });
  }

  const declaredPromptNames = Object.keys(manifest.artifacts.prompts ?? {}).sort();
  const selectedPromptNames = [...(target.prompts ?? [])].sort();
  const unknownPrompts = selectedPromptNames.filter((name) => !declaredPromptNames.includes(name));
  const unappliedPrompts = declaredPromptNames.filter(
    (name) => !selectedPromptNames.includes(name),
  );

  if (unknownPrompts.length > 0) {
    issues.push({
      severity: "error",
      code: "manifest.eval.target.prompt_unknown",
      message: `Eval target references unknown prompt artifact(s): ${unknownPrompts.join(", ")}.`,
      manifestPath: "eval.target.prompts",
      fix: "Reference only keys declared under artifacts.prompts.",
    });
  }
  if (unappliedPrompts.length > 0) {
    issues.push({
      severity: "error",
      code: "manifest.eval.target.prompt_unapplied",
      message: `Declared prompt artifact(s) are not applied by the eval target: ${unappliedPrompts.join(", ")}.`,
      manifestPath: "eval.target.prompts",
      fix: "List every declared prompt artifact in eval.target.prompts, in execution order.",
    });
  }

  return issues;
}

function isPinnedModelName(model: string): boolean {
  return (
    /\d{4}[-._]\d{2}[-._]\d{2}/u.test(model) || /(?:^|[-._])v?\d+(?:\.\d+){0,2}$/iu.test(model)
  );
}

function formatSchemaErrors(errors: readonly ErrorObject[]): readonly ManifestValidationIssue[] {
  return errors.map((error) => {
    const manifestPath = error.instancePath
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"))
      .join(".");

    return {
      severity: "error",
      code: "manifest.schema.invalid",
      message: schemaErrorMessage(error),
      manifestPath: manifestPath.length > 0 ? manifestPath : undefined,
      fix: "Update .aistate.yml to match the manifest v1 schema.",
    };
  });
}

function schemaErrorMessage(error: ErrorObject): string {
  if (error.keyword === "required" && "missingProperty" in error.params) {
    return `Missing required field "${String(error.params.missingProperty)}".`;
  }

  return `Schema validation failed at "${error.instancePath || "/"}": ${error.message ?? error.keyword}.`;
}

function resultFromIssues(
  options: ValidateManifestFileOptions,
  manifest: AIStateManifest | undefined,
  errors: readonly ManifestValidationIssue[],
  warnings: readonly ManifestValidationIssue[],
  resolvedPaths: readonly ManifestValidationResult["resolvedPaths"][number][],
): ManifestValidationResult {
  return {
    valid: errors.length === 0,
    manifestPath: options.manifestPath,
    manifest,
    errors,
    warnings,
    resolvedPaths,
  };
}
