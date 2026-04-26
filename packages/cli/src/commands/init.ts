import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { Command } from "commander";

import {
  applyTemplateName,
  getTemplate,
  scanProject,
  type ArtifactKind,
  type DetectedArtifact,
  type WritableStreamLike,
} from "@aidrift/core";

export interface RegisterInitCommandOptions {
  readonly io: {
    readonly stdout: WritableStreamLike;
    readonly stderr: WritableStreamLike;
  };
}

interface InitCommandOptions {
  readonly dir?: string;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
  readonly template?: string;
}

export function registerInitCommand(program: Command, options: RegisterInitCommandOptions): void {
  program
    .command("init")
    .description("Scan a project directory and generate a .aistate.yml manifest.")
    .option("--dir <path>", "Directory to scan (default: cwd)")
    .option("--dry-run", "Print manifest to stdout instead of writing to disk")
    .option("-y, --yes", "Skip interactive confirmation, accept all detected artifacts")
    .option(
      "--template <name>",
      "Skip scanner, use a built-in template (basic-llm, rag-pipeline, agent)",
    )
    .action(async (commandOptions: InitCommandOptions) => {
      const targetDir = path.resolve(commandOptions.dir ?? process.cwd());
      const projectName = path.basename(targetDir);
      const outputPath = path.join(targetDir, ".aistate.yml");

      let yamlContent: string;

      if (commandOptions.template !== undefined) {
        // Template path
        let templateEntry;
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
        options.io.stderr.write(formatScanSummary(kindCounts));

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
        await fs.writeFile(outputPath, yamlContent, "utf8");
        options.io.stderr.write(`Written: ${outputPath}\n`);
      } catch (error) {
        options.io.stderr.write(
          `Error: failed to write ${outputPath}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    });
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

function formatScanSummary(counts: Map<ArtifactKind, number>): string {
  if (counts.size === 0) {
    return "No artifacts detected.\n";
  }
  const lines: string[] = ["Detected artifacts:"];
  for (const [kind, count] of counts) {
    lines.push(`  ${kind}: ${count}`);
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
  const toolEntries: string[] = [];
  const ragEntries: string[] = [];

  for (const artifact of artifacts) {
    const key = relativePathToKey(artifact.relativePath);
    const relPath = `./${artifact.relativePath}`;

    if (artifact.kind === "prompt") {
      promptEntries.push(`    ${key}:\n      type: prompt\n      path: ${relPath}`);
    } else if (artifact.kind === "tool_schema") {
      toolEntries.push(`    ${key}:\n      type: tool_schema\n      path: ${relPath}`);
    } else if (artifact.kind === "rag_config") {
      ragEntries.push(`    ${key}:\n      type: rag_config\n      path: ${relPath}`);
    }
    // model_env_ref: skip
  }

  const artifactsBlock = buildArtifactsBlock(promptEntries, toolEntries, ragEntries);

  return (
    `version: "1"\n` +
    `name: "${projectName}"\n` +
    `artifacts:\n` +
    artifactsBlock +
    `eval:\n` +
    `  suite: ./evals\n` +
    `storage:\n` +
    `  backend: local\n` +
    `  path: ./.aidrift/snapshots\n`
  );
}

function buildArtifactsBlock(
  promptEntries: string[],
  toolEntries: string[],
  ragEntries: string[],
): string {
  if (promptEntries.length === 0 && toolEntries.length === 0 && ragEntries.length === 0) {
    return `  {}\n`;
  }

  const sections: string[] = [];

  if (promptEntries.length > 0) {
    sections.push(`  prompts:\n${promptEntries.join("\n")}`);
  }
  if (toolEntries.length > 0) {
    sections.push(`  tools:\n${toolEntries.join("\n")}`);
  }
  if (ragEntries.length > 0) {
    sections.push(`  rag:\n${ragEntries.join("\n")}`);
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
