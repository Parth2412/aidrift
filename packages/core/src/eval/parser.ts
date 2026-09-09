import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";
import safeRegex from "safe-regex2";
import { parseDocument } from "yaml";

import { containsSecretLikeValue } from "../manifest/security.js";
import { structuredValueLimitViolation } from "../files/structured-value.js";
import { compileJsonSchema } from "./json-schema-engine.js";
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

const MAX_ASSERTION_SOURCE_BYTES = 2 * 1024 * 1024;

export interface ParseEvalSuiteSourceOptions {
  readonly suitePath: string;
  readonly source: string;
}

export function parseEvalSuiteSource(options: ParseEvalSuiteSourceOptions): SuiteParseResult {
  if (Buffer.byteLength(options.source, "utf8") > MAX_ASSERTION_SOURCE_BYTES) {
    return {
      valid: false,
      errors: [
        {
          severity: "error",
          code: "assertion.suite.too_large",
          message: `Assertion source exceeds the ${MAX_ASSERTION_SOURCE_BYTES}-byte limit.`,
          suitePath: options.suitePath,
          fix: "Split the assertion suite into files no larger than 2 MiB.",
        },
      ],
      warnings: [],
    };
  }
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

  let parsed: unknown;
  try {
    parsed = document.toJS({ mapAsMap: false, maxAliasCount: 100 }) as unknown;
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          severity: "error",
          code: "assertion.yaml.invalid",
          message:
            error instanceof Error ? error.message : "Assertion YAML could not be expanded safely.",
          suitePath: options.suitePath,
          fix: "Remove excessive YAML aliases and use explicit bounded assertion values.",
        },
      ],
      warnings: [],
    };
  }
  if (containsSecretLikeValue(options.source)) {
    return {
      valid: false,
      errors: [
        {
          severity: "error",
          code: "assertion.secret.disallowed",
          message: "Secret-like content is not allowed in an assertion suite.",
          suitePath: options.suitePath,
          fix: "Remove credentials from assertions and load them from a provider environment variable.",
        },
      ],
      warnings: [],
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
      errors: [
        {
          severity: "error",
          code: "assertion.complexity.exceeded",
          message: complexityViolation,
          suitePath: options.suitePath,
          fix: "Flatten or split the assertion suite so it stays within structural limits.",
        },
      ],
      warnings: [],
    };
  }
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
    ...findUnsupportedAssertionProperties(suite, options.suitePath),
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

const COMMON_ASSERTION_PROPERTIES = new Set([
  "id",
  "type",
  "description",
  "tags",
  "critical",
  "input",
]);
const TYPE_ASSERTION_PROPERTIES = {
  contains: new Set(["expected_contains", "expected_not_contains"]),
  regex: new Set(["pattern", "flags"]),
  json_schema: new Set(["expected_schema"]),
} as const;

function findUnsupportedAssertionProperties(
  suite: EvalSuite,
  suitePath: string,
): readonly EvalIssue[] {
  return suite.assertions.flatMap((assertion): EvalIssue[] => {
    const allowed = TYPE_ASSERTION_PROPERTIES[assertion.type] as ReadonlySet<string>;
    const unsupported = Object.keys(assertion).filter(
      (property) => !COMMON_ASSERTION_PROPERTIES.has(property) && !allowed.has(property),
    );
    return unsupported.map((property) => ({
      severity: "error",
      code: "assertion.property.unsupported",
      message: `Assertion "${assertion.id}" has unsupported property "${property}" for type "${assertion.type}".`,
      suitePath,
      assertionId: assertion.id,
      fix: `Remove "${property}" or use a property supported by ${assertion.type} assertions.`,
    }));
  });
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
        code: "assertion.type.unsupported",
        message: `Assertion type "${candidate.type}" is not supported by this release.`,
        suitePath,
        assertionId: typeof candidate.id === "string" ? candidate.id : undefined,
        fix: "Use one of the supported assertion types: contains, regex, or json_schema.",
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
      const pattern = new RegExp(assertion.pattern, assertion.flags);
      if (!safeRegex(pattern)) {
        return [
          {
            severity: "error",
            code: "assertion.regex.unsafe",
            message: `Regex pattern for assertion "${assertion.id}" may exhibit catastrophic backtracking.`,
            suitePath,
            assertionId: assertion.id,
            fix: "Simplify nested or repeated quantifiers and use a bounded linear-time pattern.",
          },
        ];
      }
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

    try {
      compileJsonSchema(assertion.expected_schema);
      return [];
    } catch (error) {
      return [
        {
          severity: "error",
          code: "assertion.json_schema.invalid",
          message: `Invalid or unsafe JSON Schema for assertion "${assertion.id}": ${
            error instanceof Error ? error.message : "schema compilation failed"
          }`,
          suitePath,
          assertionId: assertion.id,
          fix: "Use a bounded JSON Schema with local references and RE2-compatible patterns.",
        },
      ];
    }
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
    fix: "Update assertion YAML to match the supported assertion schema.",
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
