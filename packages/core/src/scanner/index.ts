import fs from "node:fs/promises";
import path from "node:path";

import { globIterate } from "glob";

import { AIDriftError, ExitCode } from "../errors.js";
import { readUtf8FileWithinLimit } from "../files/bounded-read.js";
import {
  isProjectPathGitIgnored,
  loadProjectGitIgnore,
  portablePath,
  type GitIgnoreContext,
} from "../files/gitignore.js";
import type {
  ArtifactKind,
  DetectedArtifact,
  DetectedModelProvider,
  DetectedModelProviderName,
  ScanProjectOptions,
  ScanResult,
} from "./types.js";

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.aidrift/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.venv/**",
  "**/venv/**",
];
const PROMPT_EXTENSIONS = "{md,txt,jinja2,j2,mustache}";
const CONFIG_EXTENSIONS = "{yml,yaml,json,toml}";
const MAX_DEPENDENCY_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SCANNED_MATCHES = 100_000;
const MAX_DETECTED_ARTIFACTS = 10_000;
const MAX_DEPENDENCY_MANIFESTS = 10_000;

interface KindRule {
  readonly kind: ArtifactKind;
  readonly patterns: readonly string[];
  readonly dot?: boolean;
}

const KIND_RULES: readonly KindRule[] = [
  {
    kind: "prompt",
    patterns: [
      `**/{prompts,templates,system_prompts}/**/*.${PROMPT_EXTENSIONS}`,
      `**/{system_prompt*,system-prompt*}.${PROMPT_EXTENSIONS}`,
      `{system,prompt,instructions}.${PROMPT_EXTENSIONS}`,
    ],
  },
  {
    kind: "tool_schema",
    patterns: [
      "**/openapi.{yml,yaml,json}",
      "**/*.schema.json",
      "**/{tools,functions,schemas}/**/*.json",
    ],
  },
  {
    kind: "rag_config",
    patterns: [
      "**/*.index",
      `**/{rag,retrieval}/**/*.${CONFIG_EXTENSIONS}`,
      `**/{rag*,embedding*,chromadb*,pinecone*,weaviate*}.${CONFIG_EXTENSIONS}`,
    ],
  },
  {
    kind: "safety_rules",
    patterns: ["**/{safety,guardrails,rules}/**/*.{yml,yaml,json,txt,md}"],
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
  const ignoreContexts = await loadProjectGitIgnore(dir, DEFAULT_IGNORE);
  let scannedMatches = 0;

  for (const rule of KIND_RULES) {
    for (const pattern of rule.patterns) {
      for await (const absolutePath of globIterate(pattern, {
        cwd: dir,
        absolute: true,
        ignore: DEFAULT_IGNORE,
        dot: rule.dot === true, // only true for rules that explicitly need it (e.g. .env*)
        nodir: true, // files only
        follow: false,
      })) {
        scannedMatches += 1;
        if (scannedMatches > MAX_SCANNED_MATCHES) {
          throw scanLimitError(`Project scan matched more than ${MAX_SCANNED_MATCHES} paths.`);
        }
        const relativePath = portablePath(path.relative(dir, absolutePath));
        if (!isProjectPathGitIgnored(relativePath, ignoreContexts) && !seen.has(absolutePath)) {
          seen.set(absolutePath, rule.kind);
          if (seen.size > MAX_DETECTED_ARTIFACTS) {
            throw scanLimitError(
              `Project scan detected more than ${MAX_DETECTED_ARTIFACTS} AI artifact files.`,
            );
          }
        }
      }
    }
  }

  const artifacts: DetectedArtifact[] = Array.from(seen.entries())
    .map(([absolutePath, kind]) => ({
      kind,
      absolutePath,
      relativePath: portablePath(path.relative(dir, absolutePath)),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const modelProviders = await detectModelProviders(dir, ignoreContexts);

  return { root: dir, artifacts, modelProviders };
}

async function detectModelProviders(
  root: string,
  ignoreContexts: readonly GitIgnoreContext[],
): Promise<readonly DetectedModelProvider[]> {
  const realRoot = await fs.realpath(root);
  const filenames: string[] = [];
  for await (const filename of globIterate("**/{package.json,requirements.txt,pyproject.toml}", {
    cwd: root,
    absolute: true,
    dot: false,
    nodir: true,
    follow: false,
    ignore: DEFAULT_IGNORE,
  })) {
    filenames.push(filename);
    if (filenames.length > MAX_DEPENDENCY_MANIFESTS) {
      throw scanLimitError(
        `Project scan found more than ${MAX_DEPENDENCY_MANIFESTS} dependency manifests.`,
      );
    }
  }
  const detected: DetectedModelProvider[] = [];

  for (const filename of filenames.sort()) {
    const relativePath = portablePath(path.relative(root, filename));
    if (isProjectPathGitIgnored(relativePath, ignoreContexts)) continue;
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.size > MAX_DEPENDENCY_MANIFEST_BYTES) continue;
    const realFilename = await fs.realpath(filename);
    if (!isPathInside(realRoot, realFilename)) continue;
    const basename = path.basename(filename);
    const source = (await readUtf8FileWithinLimit(filename, MAX_DEPENDENCY_MANIFEST_BYTES)).content;
    if (basename === "package.json") {
      detected.push(...detectJavaScriptProviders(source, relativePath));
    } else if (basename === "requirements.txt") {
      detected.push(...detectRequirementsProviders(source, relativePath));
    } else {
      detected.push(...detectPyprojectProviders(source, relativePath));
    }
  }

  return detected.sort(
    (left, right) =>
      left.relativePath.localeCompare(right.relativePath) || left.name.localeCompare(right.name),
  );
}

function scanLimitError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "scan.limit_exceeded",
    exitCode: ExitCode.ConfigError,
    what: "The project cannot be scanned within the configured safety limits.",
    why: reason,
    fix: "Narrow the project directory or add generated and vendor directories to .gitignore.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

const JAVASCRIPT_PROVIDER_PACKAGES = {
  openai: "openai",
  "@anthropic-ai/sdk": "anthropic",
  "cohere-ai": "cohere",
} as const satisfies Readonly<Record<string, DetectedModelProviderName>>;

function detectJavaScriptProviders(
  source: string,
  relativePath: string,
): readonly DetectedModelProvider[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch {
    return [];
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return [];

  const packageManifest = manifest as Record<string, unknown>;
  const dependencyNames = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = packageManifest[field];
    if (dependencies !== null && typeof dependencies === "object" && !Array.isArray(dependencies)) {
      Object.keys(dependencies).forEach((dependency) => dependencyNames.add(dependency));
    }
  }

  return Object.entries(JAVASCRIPT_PROVIDER_PACKAGES)
    .filter(([dependency]) => dependencyNames.has(dependency))
    .map(([dependency, name]) => ({
      name,
      ecosystem: "javascript" as const,
      dependency,
      relativePath,
    }));
}

function detectRequirementsProviders(
  source: string,
  relativePath: string,
): readonly DetectedModelProvider[] {
  const dependencies = new Set<DetectedModelProviderName>();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*(openai|anthropic|cohere)(?=\s*(?:$|[<>=!~;@\[]))/iu.exec(line);
    if (match?.[1] !== undefined) {
      dependencies.add(match[1].toLowerCase() as DetectedModelProviderName);
    }
  }
  return toPythonProviders(dependencies, relativePath);
}

function detectPyprojectProviders(
  source: string,
  relativePath: string,
): readonly DetectedModelProvider[] {
  const dependencies = new Set<DetectedModelProviderName>();
  let section = "";
  let collectingArray = false;

  for (const line of source.split(/\r?\n/u)) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    if (sectionMatch?.[1] !== undefined) {
      section = sectionMatch[1].trim().toLowerCase();
      collectingArray = false;
      continue;
    }

    const isPoetryDependencies =
      section === "tool.poetry.dependencies" ||
      /^tool\.poetry\.group\.[^.]+\.dependencies$/u.test(section);
    if (isPoetryDependencies) {
      const keyMatch = /^\s*(?:["']([^"']+)["']|([A-Za-z0-9_.-]+))\s*=/u.exec(line);
      addPythonDependency(dependencies, keyMatch?.[1] ?? keyMatch?.[2]);
      continue;
    }

    const arrayAssignment =
      (section === "project" && /^\s*dependencies\s*=\s*\[/u.test(line)) ||
      ((section === "project.optional-dependencies" || section === "dependency-groups") &&
        /^\s*[A-Za-z0-9_.-]+\s*=\s*\[/u.test(line)) ||
      (section === "tool.uv" && /^\s*dev-dependencies\s*=\s*\[/u.test(line));
    if (arrayAssignment) collectingArray = true;
    if (!collectingArray) continue;

    for (const match of line.matchAll(/["']([^"']+)["']/gu)) {
      addPythonDependency(dependencies, match[1]);
    }
    if (line.includes("]")) collectingArray = false;
  }

  return toPythonProviders(dependencies, relativePath);
}

function addPythonDependency(
  dependencies: Set<DetectedModelProviderName>,
  specifier: string | undefined,
): void {
  if (specifier === undefined) return;
  const match = /^\s*(openai|anthropic|cohere)(?=\s*(?:$|[<>=!~;@\[]))/iu.exec(specifier);
  if (match?.[1] !== undefined) {
    dependencies.add(match[1].toLowerCase() as DetectedModelProviderName);
  }
}

function toPythonProviders(
  dependencies: ReadonlySet<DetectedModelProviderName>,
  relativePath: string,
): readonly DetectedModelProvider[] {
  return [...dependencies].sort().map((dependency) => ({
    name: dependency,
    ecosystem: "python" as const,
    dependency,
    relativePath,
  }));
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
