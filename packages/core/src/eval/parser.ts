import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import { ASSERTION_SUITE_SCHEMA } from "./schema.js";
import {
  isDeferredAssertionType,
  type Assertion,
  type EvalIssue,
  type EvalSuite,
  type SuiteParseResult,
} from "./types.js";

const suiteAjv = new Ajv2020({ allErrors: true, strict: false });
const validateSuiteSchema = suiteAjv.compile(ASSERTION_SUITE_SCHEMA);

const schemaAjv = new Ajv2020({ allErrors: true, strict: false });

export interface ParseEvalSuiteSourceOptions {
  readonly suitePath: string;
  readonly source: string;
}

export function parseEvalSuiteSource(options: ParseEvalSuiteSourceOptions): SuiteParseResult {
  const document = parseDocument(options.source, { prettyErrors: false });

  if (document.errors.length > 0) {
    return {
      valid: false,
      errors: document.errors.map((error) => {
        const location = getYamlErrorLocation(options.source, error);
        return {
          severity: "error",
          code: "assertion.yaml.invalid",
          message: error.message,
          suitePath: options.suitePath,
          line: location.line,
          column: location.column,
          fix: "Fix assertion YAML syntax before running aidrift plan.",
        };
      }),
      warnings: [],
    };
  }

  const parsed = document.toJS({ mapAsMap: false }) as unknown;
  const deferredErrors = findDeferredAssertionTypes(parsed, options.suitePath);
  if (deferredErrors.length > 0) {
    return { valid: false, errors: deferredErrors, warnings: [] };
  }

  if (!validateSuiteSchema(parsed)) {
    return {
      valid: false,
      errors: formatSchemaErrors(validateSuiteSchema.errors ?? [], options.suitePath),
      warnings: [],
    };
  }

  const suite = parsed as EvalSuite;
  const semanticErrors = [
    ...findDuplicateIds(suite, options.suitePath),
    ...findInvalidRegexes(suite.assertions, options.suitePath),
    ...findInvalidJsonSchemas(suite.assertions, options.suitePath),
  ];

  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors, warnings: [] };
  }

  return {
    valid: true,
    suite: { ...suite, sourcePath: options.suitePath },
    errors: [],
    warnings: [],
  };
}

function findDeferredAssertionTypes(parsed: unknown, suitePath: string): readonly EvalIssue[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.assertions)) {
    return [];
  }

  return parsed.assertions.flatMap((candidate): EvalIssue[] => {
    if (!isRecord(candidate) || typeof candidate.type !== "string") {
      return [];
    }

    if (!isDeferredAssertionType(candidate.type)) {
      return [];
    }

    return [
      {
        severity: "error",
        code: "assertion.type.unsupported_in_phase_9",
        message: `Assertion type "${candidate.type}" is deferred to Phase 10.`,
        suitePath,
        assertionId: typeof candidate.id === "string" ? candidate.id : undefined,
        fix: "Use contains, regex, or json_schema in Phase 9.",
      },
    ];
  });
}

function findDuplicateIds(suite: EvalSuite, suitePath: string): readonly EvalIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const assertion of suite.assertions) {
    if (seen.has(assertion.id)) {
      duplicates.add(assertion.id);
    }
    seen.add(assertion.id);
  }

  return [...duplicates].map((id) => ({
    severity: "error",
    code: "assertion.id.duplicate",
    message: `Duplicate assertion id "${id}".`,
    suitePath,
    assertionId: id,
    fix: "Use unique assertion ids across the eval suite.",
  }));
}

function findInvalidRegexes(
  assertions: readonly Assertion[],
  suitePath: string,
): readonly EvalIssue[] {
  return assertions.flatMap((assertion): EvalIssue[] => {
    if (assertion.type !== "regex") {
      return [];
    }

    try {
      new RegExp(assertion.pattern, assertion.flags);
      return [];
    } catch (error) {
      return [
        {
          severity: "error",
          code: "assertion.regex.invalid",
          message: `Invalid regex pattern for assertion "${assertion.id}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          suitePath,
          assertionId: assertion.id,
          fix: "Use a valid JavaScript regular expression pattern and flags.",
        },
      ];
    }
  });
}

function findInvalidJsonSchemas(
  assertions: readonly Assertion[],
  suitePath: string,
): readonly EvalIssue[] {
  return assertions.flatMap((assertion): EvalIssue[] => {
    if (assertion.type !== "json_schema") {
      return [];
    }

    const valid = schemaAjv.validateSchema(assertion.expected_schema);
    if (valid) {
      return [];
    }

    return [
      {
        severity: "error",
        code: "assertion.json_schema.invalid",
        message: `Invalid JSON Schema for assertion "${assertion.id}": ${schemaAjv.errorsText(
          schemaAjv.errors,
        )}`,
        suitePath,
        assertionId: assertion.id,
        fix: "Update expected_schema to a valid JSON Schema.",
      },
    ];
  });
}

function formatSchemaErrors(
  errors: readonly ErrorObject[],
  suitePath: string,
): readonly EvalIssue[] {
  return errors.map((error) => ({
    severity: "error",
    code: "assertion.schema.invalid",
    message: schemaErrorMessage(error),
    suitePath,
    fix: "Update assertion YAML to match the Phase 9 assertion schema.",
  }));
}

function schemaErrorMessage(error: ErrorObject): string {
  if (error.keyword === "required" && "missingProperty" in error.params) {
    return `Missing required field "${String(error.params.missingProperty)}".`;
  }

  return `Schema validation failed at "${error.instancePath || "/"}": ${
    error.message ?? error.keyword
  }.`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
