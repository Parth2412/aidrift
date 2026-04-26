import { readFile } from "node:fs/promises";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

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

export async function validateManifestFile(
  options: ValidateManifestFileOptions,
): Promise<ManifestValidationResult> {
  try {
    const source = await readFile(options.manifestPath, "utf8");
    return validateManifestSource({ ...options, source });
  } catch (error) {
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
}

export async function validateManifestSource(
  options: ValidateManifestSourceOptions,
): Promise<ManifestValidationResult> {
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

  const parsed = document.toJS({ mapAsMap: false }) as unknown;

  errors.push(...findManifestSecrets(parsed));

  if (!validateSchema(parsed)) {
    errors.push(...formatSchemaErrors(validateSchema.errors ?? []));
  }

  if (errors.length > 0) {
    return resultFromIssues(options, undefined, errors, warnings, []);
  }

  const manifest = parsed as AIStateManifest;
  const semanticIssues = validateModelArtifacts(manifest);
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
        fix: "Use a specific model ID such as gpt-4o-2024-08-06 instead of a rolling alias.",
      });
    }
  });

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
