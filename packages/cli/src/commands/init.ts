import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";

import { Command } from "commander";

import {
  applyTemplateName,
  BoundedFileReadError,
  getTemplate,
  readUtf8FileWithinLimit,
  scanProject,
  type ArtifactKind,
  type DetectedArtifact,
  type DetectedModelProvider,
  type TemplateEntry,
  type WritableStreamLike,
} from "@zettacore/aidrift-core";

export interface RegisterInitCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
}

interface InitCommandOptions {
  readonly dir?: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly yes?: boolean;
  readonly template?: string;
}

const STARTER_SUITE_FILENAME = "starter.assertions.yml";
const MAX_INIT_DIRECTORY_ENTRIES = 10_000;
const MAX_GITIGNORE_BYTES = 1024 * 1024;
const STARTER_SUITE = `suite: aidrift-starter
description: "Replace this smoke assertion with behavior specific to your AI system."
assertions:
  - id: returns-non-empty-response
    type: regex
    description: "The configured target returns at least one character."
    tags:
      - quickstart
    critical: true
    input: "Return one short, safe sentence."
    pattern: ".+"
`;

export function registerInitCommand(program: Command, options: RegisterInitCommandOptions): void {
  program
    .command("init")
    .description("Scan a project directory and generate a .aistate.yml manifest.")
    .option("--dir <path>", "Directory to scan (default: cwd)")
    .option("--dry-run", "Print manifest to stdout instead of writing to disk")
    .option("--force", "Overwrite an existing .aistate.yml manifest")
    .option("-y, --yes", "Skip interactive confirmation, accept all detected artifacts")
    .option(
      "--template <name>",
      "Skip scanner, use a built-in template (basic-llm, rag-pipeline, agent)",
    )
    .action(async (commandOptions: InitCommandOptions) => {
      const targetDir = path.resolve(commandOptions.dir ?? process.cwd());
      const projectName = path.basename(targetDir);
      const outputPath = path.join(targetDir, ".aistate.yml");

      if (
        commandOptions.dryRun !== true &&
        commandOptions.force !== true &&
        (await pathExists(outputPath))
      ) {
        options.io.stderr.write(
          `Error: manifest already exists: ${outputPath}\n` +
            "Use --dry-run to preview changes or --force to overwrite it.\n",
        );
        process.exitCode = 2;
        return;
      }

      let yamlContent: string;
      let templateEntry: TemplateEntry | undefined;

      if (commandOptions.template !== undefined) {
        // Template path
        try {
          templateEntry = getTemplate(commandOptions.template);
        } catch {
          options.io.stderr.write(
            `Error: Unknown template "${commandOptions.template}". ` +
              `Available: basic-llm, rag-pipeline, agent\n`,
          );
          process.exitCode = 2;
          return;
        }
        yamlContent = applyTemplateName(templateEntry, projectName);
      } else {
        // Scanner path
        const scanResult = await scanProject({ dir: targetDir });
        const artifacts = scanResult.artifacts;

        // Show detected artifacts summary on stderr
        const kindCounts = countByKind(artifacts);
        options.io.stderr.write(formatScanSummary(kindCounts, scanResult.modelProviders));

        // Confirm unless --yes or non-TTY
        const skipConfirm = commandOptions.yes === true || process.stdout.isTTY !== true;
        if (skipConfirm && commandOptions.yes !== true && process.stdout.isTTY !== true) {
          options.io.stderr.write("Non-interactive mode: proceeding without confirmation.\n");
        }
        if (!skipConfirm) {
          const confirmed = await askConfirm(`Write .aistate.yml to ${outputPath}? (y/N) `);
          if (!confirmed) {
            options.io.stderr.write("Aborted.\n");
            return;
          }
        }

        yamlContent = buildManifestYaml(projectName, artifacts);
      }

      if (commandOptions.dryRun === true) {
        options.io.stdout.write(yamlContent);
        return;
      }

      try {
        await preflightInitWrites(targetDir, outputPath, templateEntry);
        await writeManifest(outputPath, yamlContent, commandOptions.force === true);
        options.io.stderr.write(`Written: ${outputPath}\n`);
        for (const scaffoldPath of await ensureTemplateFiles(targetDir, templateEntry)) {
          options.io.stderr.write(`Written: ${scaffoldPath}\n`);
        }
        const starterSuitePath = await ensureStarterEvalSuite(targetDir);
        if (starterSuitePath !== undefined) {
          options.io.stderr.write(`Written: ${starterSuitePath}\n`);
        }
        await fs.mkdir(path.join(targetDir, ".aidrift"), { recursive: true });
        const gitignorePath = await ensureAidriftGitignore(targetDir);
        if (gitignorePath !== undefined) {
          options.io.stderr.write(`Updated: ${gitignorePath}\n`);
        }
      } catch (error) {
        options.io.stderr.write(
          `Error: failed to initialize ${targetDir}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    });
}

async function writeManifest(
  outputPath: string,
  content: string,
  overwrite: boolean,
): Promise<void> {
  if (!overwrite) {
    await fs.writeFile(outputPath, content, { encoding: "utf8", flag: "wx" });
    return;
  }

  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function preflightInitWrites(
  targetDir: string,
  outputPath: string,
  templateEntry: TemplateEntry | undefined,
): Promise<void> {
  const paths = [
    outputPath,
    path.join(targetDir, "evals", STARTER_SUITE_FILENAME),
    path.join(targetDir, ".aidrift"),
    path.join(targetDir, ".gitignore"),
    ...Object.keys(templateEntry?.files ?? {}).map((relativePath) =>
      path.resolve(targetDir, relativePath),
    ),
  ];
  for (const filename of paths) {
    await assertSafeProjectWritePath(targetDir, filename);
  }
  await assertInitInputLimits(targetDir);
}

async function assertInitInputLimits(targetDir: string): Promise<void> {
  const gitignorePath = path.join(targetDir, ".gitignore");
  try {
    await readUtf8FileWithinLimit(gitignorePath, MAX_GITIGNORE_BYTES);
  } catch (error) {
    if (error instanceof BoundedFileReadError) {
      throw new Error(`cannot safely update .gitignore: ${error.message}`);
    }
    if (!isNotFoundError(error)) throw error;
  }

  const suiteDirectory = path.join(targetDir, "evals");
  let directory;
  try {
    directory = await fs.opendir(suiteDirectory);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  let entries = 0;
  for await (const _entry of directory) {
    entries += 1;
    if (entries > MAX_INIT_DIRECTORY_ENTRIES) {
      throw new Error(`evals contains more than ${MAX_INIT_DIRECTORY_ENTRIES} directory entries.`);
    }
  }
}

async function assertSafeProjectWritePath(targetDir: string, filename: string): Promise<void> {
  const relative = path.relative(targetDir, filename);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`write path resolves outside the project: ${filename}`);
  }

  let current = targetDir;
  for (const segment of relative.split(path.sep).filter((value) => value.length > 0)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`refusing to write through symbolic link: ${current}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) break;
      throw error;
    }
  }
}

async function ensureTemplateFiles(
  targetDir: string,
  templateEntry: TemplateEntry | undefined,
): Promise<readonly string[]> {
  const written: string[] = [];
  for (const [relativePath, content] of Object.entries(templateEntry?.files ?? {})) {
    const filename = path.resolve(targetDir, relativePath);

    await fs.mkdir(path.dirname(filename), { recursive: true });
    try {
      await fs.writeFile(filename, content, { encoding: "utf8", flag: "wx" });
      written.push(filename);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }
  return written;
}

async function pathExists(filename: string): Promise<boolean> {
  try {
    await fs.access(filename);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function ensureStarterEvalSuite(targetDir: string): Promise<string | undefined> {
  const suiteDirectory = path.join(targetDir, "evals");
  await fs.mkdir(suiteDirectory, { recursive: true });
  let entries = 0;
  const directory = await fs.opendir(suiteDirectory);
  for await (const entry of directory) {
    entries += 1;
    if (entries > MAX_INIT_DIRECTORY_ENTRIES) {
      throw new Error(`evals contains more than ${MAX_INIT_DIRECTORY_ENTRIES} directory entries.`);
    }
    if (/\.assertions\.ya?ml$/u.test(entry.name)) return undefined;
  }

  const starterSuitePath = path.join(suiteDirectory, STARTER_SUITE_FILENAME);
  try {
    await fs.writeFile(starterSuitePath, STARTER_SUITE, { encoding: "utf8", flag: "wx" });
    return starterSuitePath;
  } catch (error) {
    if (isAlreadyExistsError(error)) return undefined;
    throw error;
  }
}

async function ensureAidriftGitignore(targetDir: string): Promise<string | undefined> {
  const filename = path.join(targetDir, ".gitignore");
  const marker = ".aidrift/";
  let existing = "";
  let existingBytes = 0;
  try {
    const boundedFile = await readUtf8FileWithinLimit(filename, MAX_GITIGNORE_BYTES);
    existing = boundedFile.content;
    existingBytes = boundedFile.sizeBytes;
  } catch (error) {
    if (error instanceof BoundedFileReadError) {
      throw new Error(`cannot safely update .gitignore: ${error.message}`);
    }
    if (!isNotFoundError(error)) throw error;
  }

  let isIgnored = false;
  for (const line of existing.split(/\r?\n/u).map((value) => value.trim())) {
    if (line === marker || line === `/${marker}` || line === ".aidrift") isIgnored = true;
    if (line === `!${marker}` || line === `!/${marker}` || line === "!.aidrift") isIgnored = false;
  }
  if (isIgnored) return undefined;

  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const block = `${separator}${existing.length === 0 ? "" : "\n"}# AIDrift snapshot data\n${marker}\n`;
  if (existingBytes + Buffer.byteLength(block, "utf8") > MAX_GITIGNORE_BYTES) {
    throw new Error(`cannot safely update .gitignore beyond ${MAX_GITIGNORE_BYTES} bytes.`);
  }
  await fs.appendFile(filename, block, "utf8");
  return filename;
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countByKind(artifacts: readonly DetectedArtifact[]): Map<ArtifactKind, number> {
  const counts = new Map<ArtifactKind, number>();
  for (const artifact of artifacts) {
    counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1);
  }
  return counts;
}

function formatScanSummary(
  counts: Map<ArtifactKind, number>,
  providers: readonly DetectedModelProvider[],
): string {
  const lines: string[] = [];
  if (counts.size === 0) {
    lines.push(
      "No file artifacts detected. The generated manifest uses an offline mock model; configure artifacts manually.",
    );
  } else {
    lines.push("Detected artifacts:");
    for (const [kind, count] of counts) {
      lines.push(`  ${kind}: ${count}`);
    }
  }
  if (providers.length > 0) {
    lines.push("Detected model provider SDKs:");
    for (const provider of providers) {
      lines.push(`  ${provider.name}: ${provider.dependency} (${provider.relativePath})`);
    }
    lines.push(
      "Provider detection is informational; configure a pinned provider model when replacing the offline mock.",
    );
  }
  return lines.join("\n") + "\n";
}

function askConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function buildManifestYaml(projectName: string, artifacts: readonly DetectedArtifact[]): string {
  const promptEntries: string[] = [];
  const promptNames: string[] = [];
  const toolEntries: string[] = [];
  const ragEntries: string[] = [];
  const safetyEntries: string[] = [];
  const promptKeys = new Set<string>();
  const toolKeys = new Set<string>();
  const ragKeys = new Set<string>();
  const safetyKeys = new Set<string>();

  for (const artifact of artifacts) {
    const relPath = `./${artifact.relativePath}`;

    if (artifact.kind === "prompt") {
      const key = uniqueArtifactKey(relativePathToKey(artifact.relativePath), promptKeys);
      promptNames.push(key);
      promptEntries.push(
        `    ${yamlScalar(key)}:\n      type: prompt\n      path: ${yamlScalar(relPath)}`,
      );
    } else if (artifact.kind === "tool_schema") {
      const key = uniqueArtifactKey(relativePathToKey(artifact.relativePath), toolKeys);
      toolEntries.push(
        `    ${yamlScalar(key)}:\n      type: tool_schema\n      path: ${yamlScalar(relPath)}`,
      );
    } else if (artifact.kind === "rag_config") {
      const key = uniqueArtifactKey(relativePathToKey(artifact.relativePath), ragKeys);
      ragEntries.push(
        `    ${yamlScalar(key)}:\n      type: rag_config\n      path: ${yamlScalar(relPath)}`,
      );
    } else if (artifact.kind === "safety_rules") {
      const key = uniqueArtifactKey(relativePathToKey(artifact.relativePath), safetyKeys);
      safetyEntries.push(
        `    ${yamlScalar(key)}:\n      type: safety_rules\n      path: ${yamlScalar(relPath)}`,
      );
    }
    // model_env_ref: skip
  }

  const artifactsBlock = buildArtifactsBlock(promptEntries, toolEntries, ragEntries, safetyEntries);

  return (
    `version: "1"\n` +
    `name: ${yamlScalar(projectName)}\n` +
    `artifacts:\n` +
    artifactsBlock +
    `eval:\n` +
    `  suite: ./evals\n` +
    `  target:\n` +
    `    type: provider\n` +
    `    model: primary\n` +
    (promptNames.length === 0
      ? ""
      : `    prompts:\n${promptNames.map((name) => `      - ${yamlScalar(name)}`).join("\n")}\n`) +
    `storage:\n` +
    `  backend: local\n` +
    `  path: ./.aidrift/snapshots\n`
  );
}

function uniqueArtifactKey(base: string, used: Set<string>): string {
  const normalizedBase = base.length === 0 ? "artifact" : base;
  let candidate = normalizedBase;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${normalizedBase}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function buildArtifactsBlock(
  promptEntries: string[],
  toolEntries: string[],
  ragEntries: string[],
  safetyEntries: string[],
): string {
  const sections: string[] = [
    `  models:\n    primary:\n      type: model\n      provider: mock\n      model: mock-v1`,
  ];

  if (promptEntries.length > 0) {
    sections.push(`  prompts:\n${promptEntries.join("\n")}`);
  }
  if (toolEntries.length > 0) {
    sections.push(`  tools:\n${toolEntries.join("\n")}`);
  }
  if (ragEntries.length > 0) {
    sections.push(`  rag:\n${ragEntries.join("\n")}`);
  }
  if (safetyEntries.length > 0) {
    sections.push(`  safety:\n${safetyEntries.join("\n")}`);
  }

  return sections.join("\n") + "\n";
}

function relativePathToKey(relativePath: string): string {
  return relativePath
    .replace(/\//g, "_")
    .replace(/\\/g, "_")
    .replace(/\.[^.]+$/, "")
    .replace(/^\./, "");
}
