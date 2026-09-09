#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

export function renderCliReference(program) {
  const lines = [
    "# AIDrift CLI Reference",
    "",
    generatedNotice("Commander metadata in `packages/cli/src`"),
    "",
    "AIDrift uses process exit `0` for success, `1` for a behavioral or validation failure, and `2` for configuration/runtime errors. Individual command descriptions below are generated from the executable CLI registration.",
    "",
  ];

  appendCommand(lines, program, program.name(), "Global command");
  for (const command of program.commands) {
    appendCommand(lines, command, `${program.name()} ${command.name()}`, command.name());
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderManifestReference(schema) {
  const lines = [
    "# AIDrift Manifest v1 Schema Reference",
    "",
    generatedNotice("`AI_STATE_MANIFEST_SCHEMA` in `packages/core/src/manifest/schema.ts`"),
    "",
    `Schema identifier: \`${escapeInline(schema.$id ?? "(none)")}\``,
    "",
    "This reference describes the accepted YAML/JSON shape. Schema acceptance does not imply that every reserved feature is executable: unsupported storage, plugin, target, artifact, format, or hashing features fail closed at the command boundary. See the [README runtime contract](../../README.md) for the currently executable scope.",
    "",
    "## Root object",
    "",
  ];

  appendPropertyTable(lines, schema);

  for (const [name, propertySchema] of sortedEntries(schema.properties)) {
    if (!hasDocumentableShape(propertySchema)) continue;
    lines.push(`## \`${escapeInline(name)}\``, "", describeComposition(propertySchema), "");
    appendPropertyTable(lines, propertySchema);
  }

  lines.push("## Reusable schema definitions", "");
  for (const [name, definition] of sortedEntries(schema.$defs)) {
    lines.push(`### \`${escapeInline(name)}\``, "", describeComposition(definition), "");
    appendPropertyTable(lines, definition);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function synchronizeGeneratedFiles(outputs, options = {}) {
  const check = options.check ?? false;
  const stale = [];

  for (const [targetPath, content] of outputs) {
    let current;
    try {
      current = await fs.readFile(targetPath, "utf8");
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    if (current === content) continue;
    if (check) {
      stale.push(targetPath);
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
  }

  if (stale.length > 0) {
    const displayPaths = stale.map((targetPath) => path.relative(repositoryRoot, targetPath));
    throw new Error(
      `Generated references are stale:\n${displayPaths.map((value) => `- ${value}`).join("\n")}\nRun pnpm docs:generate and commit the results.`,
    );
  }
}

async function main() {
  const unsupported = process.argv.slice(2).filter((argument) => argument !== "--check");
  if (unsupported.length > 0) {
    throw new Error(`Unknown argument(s): ${unsupported.join(", ")}. Supported: --check.`);
  }

  const [{ createCliProgram }, { AI_STATE_MANIFEST_SCHEMA }, { format }] = await Promise.all([
    import(pathToFileURL(path.join(repositoryRoot, "packages/cli/dist/program.js")).href),
    import(pathToFileURL(path.join(repositoryRoot, "packages/core/dist/manifest/schema.js")).href),
    import("prettier"),
  ]);
  const sink = { write: () => true };
  const program = createCliProgram({ io: { stdout: sink, stderr: sink }, env: {} });
  const cliReference = await format(renderCliReference(program), { parser: "markdown" });
  const manifestReference = await format(renderManifestReference(AI_STATE_MANIFEST_SCHEMA), {
    parser: "markdown",
  });
  const manifestSchema = await format(`${JSON.stringify(AI_STATE_MANIFEST_SCHEMA, null, 2)}\n`, {
    parser: "json",
  });
  const outputs = new Map([
    [path.join(repositoryRoot, "docs/reference/cli.md"), cliReference],
    [path.join(repositoryRoot, "docs/reference/manifest.md"), manifestReference],
    [path.join(repositoryRoot, "packages/sdk/schemas/aistate.v1.schema.json"), manifestSchema],
  ]);

  const check = process.argv.includes("--check");
  await synchronizeGeneratedFiles(outputs, { check });
  const verb = check ? "Verified" : "Generated";
  for (const targetPath of outputs.keys()) {
    process.stdout.write(`${verb} ${path.relative(repositoryRoot, targetPath)}\n`);
  }
}

function appendCommand(lines, command, invocation, label) {
  lines.push(`## \`${escapeInline(invocation)}\``, "");
  if (label === "Global command") lines.push("Global options and command routing.", "");
  if (command.description()) lines.push(command.description(), "");
  lines.push(
    "**Usage**",
    "",
    `\`${escapeInline(invocation)} ${escapeInline(command.usage())}\``,
    "",
  );

  const argumentsList = command.registeredArguments ?? [];
  if (argumentsList.length > 0) {
    lines.push(
      "**Arguments**",
      "",
      "| Name | Required | Variadic | Description |",
      "| --- | --- | --- | --- |",
    );
    for (const argument of argumentsList) {
      lines.push(
        `| \`${escapeInline(argument.name())}\` | ${argument.required ? "yes" : "no"} | ${argument.variadic ? "yes" : "no"} | ${escapeTable(argument.description || "—")} |`,
      );
    }
    lines.push("");
  }

  const options = command.createHelp().visibleOptions(command);
  lines.push("**Options**", "", "| Flags | Description | Default |", "| --- | --- | --- |");
  for (const option of options) {
    lines.push(
      `| \`${escapeInline(option.flags)}\` | ${escapeTable(option.description || "—")} | ${formatDefault(option.defaultValue)} |`,
    );
  }
  lines.push("");
}

function appendPropertyTable(lines, schema) {
  const properties = mergedProperties(schema);
  const required = mergedRequired(schema);
  const entries = sortedEntries(properties);

  if (entries.length === 0) {
    lines.push(`Shape: ${describeShape(schema)}.`, "");
    return;
  }

  lines.push("| Property | Shape | Required | Constraints |", "| --- | --- | --- | --- |");
  for (const [name, propertySchema] of entries) {
    lines.push(
      `| \`${escapeInline(name)}\` | ${escapeTable(describeShape(propertySchema))} | ${required.has(name) ? "yes" : "no"} | ${escapeTable(describeConstraints(propertySchema))} |`,
    );
  }
  lines.push("");
}

function mergedProperties(schema) {
  const properties = { ...(schema?.properties ?? {}) };
  for (const part of schema?.allOf ?? []) {
    Object.assign(properties, part?.properties ?? {});
  }
  return properties;
}

function mergedRequired(schema) {
  const required = new Set(schema?.required ?? []);
  for (const part of schema?.allOf ?? []) {
    for (const name of part?.required ?? []) required.add(name);
  }
  return required;
}

function describeShape(schema) {
  if (schema === undefined || schema === null) return "any";
  if (schema.$ref) return `reference \`${schema.$ref}\``;
  if (schema.const !== undefined) return `constant ${formatCode(schema.const)}`;
  if (schema.enum) return schema.enum.map(formatCode).join(" or ");
  if (schema.oneOf) return `one of: ${schema.oneOf.map(describeShape).join("; ")}`;
  if (schema.anyOf) return `any of: ${schema.anyOf.map(describeShape).join("; ")}`;
  if (schema.allOf) return `all of: ${schema.allOf.map(describeShape).join("; ")}`;
  if (schema.type === "array") return `array of ${describeShape(schema.items)}`;
  if (schema.type === "object" && typeof schema.additionalProperties === "object") {
    return `map of ${describeShape(schema.additionalProperties)}`;
  }
  return schema.type ?? "any";
}

function describeConstraints(schema) {
  const values = [];
  if (schema?.minLength !== undefined) values.push(`minimum length ${schema.minLength}`);
  if (schema?.minimum !== undefined) values.push(`minimum ${schema.minimum}`);
  if (schema?.maximum !== undefined) values.push(`maximum ${schema.maximum}`);
  if (schema?.exclusiveMinimum !== undefined)
    values.push(`greater than ${schema.exclusiveMinimum}`);
  if (schema?.exclusiveMaximum !== undefined) values.push(`less than ${schema.exclusiveMaximum}`);
  if (schema?.uniqueItems === true) values.push("unique items");
  if (schema?.additionalProperties === false) values.push("unknown properties rejected");
  if (schema?.additionalProperties === true) values.push("additional properties allowed");
  if (schema?.const !== undefined) values.push(`must equal ${formatCode(schema.const)}`);
  if (schema?.enum) values.push(`allowed: ${schema.enum.map(formatCode).join(", ")}`);
  return values.join("; ") || "—";
}

function describeComposition(schema) {
  const values = [];
  if (schema?.allOf) values.push(`Composes ${schema.allOf.map(describeShape).join(" with ")}.`);
  if (schema?.oneOf) values.push(`Accepts ${schema.oneOf.map(describeShape).join(" or ")}.`);
  if (schema?.anyOf) values.push(`Accepts ${schema.anyOf.map(describeShape).join(" or ")}.`);
  if (schema?.additionalProperties === false) values.push("Unknown properties are rejected.");
  if (typeof schema?.additionalProperties === "object") {
    values.push(`Object values use ${describeShape(schema.additionalProperties)}.`);
  }
  return values.join(" ") || `Shape: ${describeShape(schema)}.`;
}

function hasDocumentableShape(schema) {
  return (
    Object.keys(mergedProperties(schema)).length > 0 ||
    schema?.oneOf !== undefined ||
    schema?.anyOf !== undefined ||
    schema?.allOf !== undefined ||
    schema?.additionalProperties !== undefined
  );
}

function generatedNotice(source) {
  return `<!-- Generated by \`pnpm docs:generate\` from ${source}. Do not edit manually. -->`;
}

function sortedEntries(value) {
  return Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function formatDefault(value) {
  return value === undefined ? "—" : formatCode(value);
}

function formatCode(value) {
  return `\`${escapeInline(typeof value === "string" ? value : JSON.stringify(value))}\``;
}

function escapeInline(value) {
  return String(value).replaceAll("`", "\\`").replaceAll("\n", " ");
}

function escapeTable(value) {
  return escapeInline(value).replaceAll("|", "\\|");
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

const invokedPath = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1]);
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Reference generation failed."}\n`,
    );
    process.exitCode = 1;
  });
}
