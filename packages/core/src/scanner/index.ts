import fs from "node:fs/promises";
import path from "node:path";

import { glob } from "glob";

import type { ArtifactKind, DetectedArtifact, ScanProjectOptions, ScanResult } from "./types.js";

const IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.aidrift/**"];

interface KindRule {
  readonly kind: ArtifactKind;
  readonly patterns: readonly string[];
  readonly dot?: boolean;
}

const KIND_RULES: readonly KindRule[] = [
  {
    kind: "prompt",
    patterns: ["**/*.md", "**/*.txt", "prompts/**/*", "**/system_prompt*"],
  },
  {
    kind: "tool_schema",
    patterns: ["**/openapi.yml", "**/openapi.yaml", "**/*.schema.json", "tools/**/*"],
  },
  {
    kind: "rag_config",
    patterns: [
      "**/*.index",
      "**/embedding*.yml",
      "**/embedding*.yaml",
      "**/embedding*.json",
      "**/rag*.yml",
      "**/rag*.yaml",
      "**/rag*.json",
    ],
  },
  {
    kind: "model_env_ref",
    patterns: [".env*"],
    dot: true,
  },
];

export async function scanProject(options: ScanProjectOptions): Promise<ScanResult> {
  const { dir } = options;

  // Fix C: validate that dir exists and is a directory.
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(dir);
  } catch {
    throw new Error(`scanProject: directory does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`scanProject: directory does not exist: ${dir}`);
  }

  // Collect (absolutePath -> kind) — first matching kind per file wins.
  const seen = new Map<string, ArtifactKind>();

  for (const rule of KIND_RULES) {
    for (const pattern of rule.patterns) {
      const matches = await glob(pattern, {
        cwd: dir,
        absolute: true,
        ignore: IGNORE,
        dot: rule.dot === true, // only true for rules that explicitly need it (e.g. .env*)
        nodir: true, // files only
      });

      for (const absolutePath of matches) {
        if (!seen.has(absolutePath)) {
          seen.set(absolutePath, rule.kind);
        }
      }
    }
  }

  const artifacts: DetectedArtifact[] = Array.from(seen.entries()).map(([absolutePath, kind]) => ({
    kind,
    absolutePath,
    relativePath: path.relative(dir, absolutePath),
  }));

  return { root: dir, artifacts };
}
