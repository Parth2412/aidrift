import fs from "node:fs/promises";

import { AIDriftError, ExitCode } from "../errors.js";
import { readUtf8FileWithinLimit } from "../files/bounded-read.js";
import { containsSecretLikeValue } from "../manifest/security.js";
import type { AIStateManifest, ModelArtifact } from "../manifest/types.js";
import { assertExistingPathWithinProject, resolvePathWithinProject } from "../snapshot/paths.js";

const MAX_PROMPT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_PROMPT_BYTES = 10 * 1024 * 1024;
const DOCS_URL = "https://github.com/Parth2412/aidrift#readme";

export interface ResolvedProviderEvalTarget {
  readonly modelName: string;
  readonly model: ModelArtifact;
  readonly promptNames: readonly string[];
  readonly systemPrompt?: string | undefined;
}

export async function resolveProviderEvalTarget(
  manifest: AIStateManifest,
  projectRoot: string,
): Promise<ResolvedProviderEvalTarget> {
  const target = manifest.eval.target;
  if (target?.type !== "provider") {
    throw targetError(
      "eval.target must declare type provider for the current executable eval contract.",
    );
  }

  const model = manifest.artifacts.models?.[target.model];
  if (model === undefined) {
    throw targetError(`eval.target.model references unknown model artifact "${target.model}".`);
  }

  const promptNames = target.prompts ?? [];
  const declaredPromptNames = Object.keys(manifest.artifacts.prompts ?? {});
  const unapplied = declaredPromptNames.filter((name) => !promptNames.includes(name));
  if (unapplied.length > 0) {
    throw targetError(`Provider eval target does not apply prompt(s): ${unapplied.join(", ")}.`);
  }

  const promptContents: string[] = [];
  let totalPromptBytes = 0;
  for (const promptName of promptNames) {
    const prompt = manifest.artifacts.prompts?.[promptName];
    if (prompt === undefined) {
      throw targetError(`eval.target.prompts references unknown prompt artifact "${promptName}".`);
    }
    if (prompt.format !== undefined && prompt.format !== "text") {
      throw targetError(
        `Prompt artifact "${promptName}" uses unsupported executable format ${prompt.format}.`,
      );
    }

    const promptPath = resolvePathWithinProject(
      projectRoot,
      prompt.path,
      `eval prompt ${promptName}`,
      false,
    );
    await assertExistingPathWithinProject(projectRoot, promptPath, `eval prompt ${promptName}`);
    const stats = await fs.stat(promptPath);
    if (!stats.isFile()) {
      throw targetError(`Prompt artifact "${promptName}" must resolve to one text file.`);
    }
    if (stats.size > MAX_PROMPT_BYTES) {
      throw targetError(
        `Prompt artifact "${promptName}" exceeds the ${MAX_PROMPT_BYTES} byte execution limit.`,
      );
    }
    totalPromptBytes += stats.size;
    if (totalPromptBytes > MAX_TOTAL_PROMPT_BYTES) {
      throw targetError(
        `Combined prompt content exceeds the ${MAX_TOTAL_PROMPT_BYTES} byte execution limit.`,
      );
    }

    let content: string;
    let contentBytes: number;
    try {
      const boundedFile = await readUtf8FileWithinLimit(promptPath, MAX_PROMPT_BYTES);
      content = boundedFile.content;
      contentBytes = boundedFile.sizeBytes;
    } catch (cause) {
      throw targetError(
        `Prompt artifact "${promptName}" could not be read within its limit.`,
        cause,
      );
    }
    totalPromptBytes += contentBytes - stats.size;
    if (totalPromptBytes > MAX_TOTAL_PROMPT_BYTES) {
      throw targetError(
        `Combined prompt content exceeds the ${MAX_TOTAL_PROMPT_BYTES} byte execution limit.`,
      );
    }
    if (containsSecretLikeValue(content)) {
      throw targetError(`Prompt artifact "${promptName}" contains secret-like content.`);
    }
    promptContents.push(content);
  }

  return {
    modelName: target.model,
    model,
    promptNames,
    ...(promptContents.length > 0 ? { systemPrompt: promptContents.join("\n\n") } : {}),
  };
}

function targetError(reason: string, cause?: unknown): AIDriftError {
  return new AIDriftError({
    code: "eval.target.invalid",
    exitCode: ExitCode.ConfigError,
    what: "The provider eval target cannot be executed safely.",
    why: reason,
    fix: "Declare one valid model and list every executed text prompt in eval.target.",
    docs: DOCS_URL,
    cause,
  });
}
