import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { RE2JS } from "re2js";

const MAX_SCHEMA_NODES = 2_000;
const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_COLLECTION_ENTRIES = 1_000;
const MAX_SCHEMA_REGEX_PATTERNS = 100;

const linearRegExp = Object.assign(
  (pattern: string, _unicodeFlag: string) => RE2JS.compile(pattern),
  { code: "aidriftRe2" },
);

const schemaAjv = new Ajv2020({
  allErrors: true,
  strict: false,
  addUsedSchema: false,
  code: { regExp: linearRegExp },
});
const validatorCache = new WeakMap<Record<string, unknown>, ValidateFunction>();

export function compileJsonSchema(schema: Record<string, unknown>): ValidateFunction<unknown> {
  const cached = validatorCache.get(schema);
  if (cached !== undefined) return cached;

  assertSchemaComplexity(schema);
  const validator = schemaAjv.compile<unknown>(schema);
  validatorCache.set(schema, validator);
  return validator;
}

function assertSchemaComplexity(schema: Record<string, unknown>): void {
  const stack: Array<{
    readonly value: unknown;
    readonly depth: number;
    readonly leaving: boolean;
  }> = [{ value: schema, depth: 0, leaving: false }];
  const active = new WeakSet<object>();
  let nodes = 0;
  let regexPatterns = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.value !== null && typeof current.value === "object" && current.leaving) {
      active.delete(current.value);
      continue;
    }
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES) {
      throw new Error(`JSON Schema exceeds the ${MAX_SCHEMA_NODES}-node limit.`);
    }
    if (current.depth > MAX_SCHEMA_DEPTH) {
      throw new Error(`JSON Schema exceeds the ${MAX_SCHEMA_DEPTH}-level depth limit.`);
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (active.has(current.value)) throw new Error("JSON Schema contains a cyclic value.");
    active.add(current.value);
    stack.push({ ...current, leaving: true });

    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_SCHEMA_COLLECTION_ENTRIES) {
        throw new Error(
          `JSON Schema array exceeds the ${MAX_SCHEMA_COLLECTION_ENTRIES}-item limit.`,
        );
      }
      for (const value of current.value) {
        stack.push({ value, depth: current.depth + 1, leaving: false });
      }
      continue;
    }

    const entries = Object.entries(current.value as Record<string, unknown>);
    if (entries.length > MAX_SCHEMA_COLLECTION_ENTRIES) {
      throw new Error(
        `JSON Schema object exceeds the ${MAX_SCHEMA_COLLECTION_ENTRIES}-property limit.`,
      );
    }
    for (const [key, value] of entries) {
      if ((key === "$ref" || key === "$dynamicRef") && typeof value === "string") {
        if (!value.startsWith("#")) {
          throw new Error("Only local JSON Schema references beginning with # are supported.");
        }
      }
      if (key === "pattern" && typeof value === "string") regexPatterns += 1;
      if (key === "patternProperties" && isRecord(value)) {
        regexPatterns += Object.keys(value).length;
      }
      if (regexPatterns > MAX_SCHEMA_REGEX_PATTERNS) {
        throw new Error(
          `JSON Schema exceeds the ${MAX_SCHEMA_REGEX_PATTERNS}-pattern safety limit.`,
        );
      }
      stack.push({ value, depth: current.depth + 1, leaving: false });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
