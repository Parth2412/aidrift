import fs from "node:fs/promises";
import path from "node:path";

import { readUtf8FileWithinLimit } from "../files/bounded-read.js";
import { MAX_PROVIDER_OUTPUT_BYTES } from "../eval/limits.js";
import { assertWritablePathWithinProject } from "../snapshot/paths.js";
import { hashProbeOutput } from "./comparator.js";
import type { ProbeSample } from "./types.js";

interface CachedProbeSample {
  readonly createdAt: string;
  readonly sample: ProbeSample;
}

const MAX_CACHE_ENTRY_BYTES = 6 * 1024 * 1024;

export interface ProbeCacheLookupOptions {
  readonly projectRoot: string;
  readonly modelName: string;
  readonly model: string;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly providerId: string;
  readonly probeId: string;
  readonly input: string;
  readonly sampleIndex: number;
  readonly ttlMinutes: number;
}

export async function readCachedProbeSample(
  options: ProbeCacheLookupOptions,
): Promise<ProbeSample | undefined> {
  if (options.ttlMinutes <= 0) {
    return undefined;
  }

  const filePath = cacheFilePath(options);
  await assertWritablePathWithinProject(options.projectRoot, filePath, "Provider probe cache");
  let raw: string;
  try {
    raw = (await readUtf8FileWithinLimit(filePath, MAX_CACHE_ENTRY_BYTES)).content;
  } catch {
    return undefined;
  }

  try {
    const cached = JSON.parse(raw) as unknown;
    if (!isCachedProbeSample(cached)) return undefined;
    const createdAtMs = Date.parse(cached.createdAt);
    if (!Number.isFinite(createdAtMs)) {
      return undefined;
    }

    const ageMs = Date.now() - createdAtMs;
    if (ageMs > options.ttlMinutes * 60 * 1000) {
      return undefined;
    }

    return { ...cached.sample, cached: true };
  } catch {
    return undefined;
  }
}

function isCachedProbeSample(value: unknown): value is CachedProbeSample {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const cached = value as Partial<CachedProbeSample>;
  const sample = cached.sample;
  return (
    typeof cached.createdAt === "string" &&
    sample !== null &&
    typeof sample === "object" &&
    typeof sample.output === "string" &&
    Buffer.byteLength(sample.output, "utf8") <= MAX_PROVIDER_OUTPUT_BYTES &&
    typeof sample.latencyMs === "number" &&
    Number.isFinite(sample.latencyMs) &&
    sample.latencyMs >= 0 &&
    (sample.costUsd === undefined ||
      (typeof sample.costUsd === "number" &&
        Number.isFinite(sample.costUsd) &&
        sample.costUsd >= 0))
  );
}

export async function writeCachedProbeSample(
  options: ProbeCacheLookupOptions,
  sample: ProbeSample,
): Promise<void> {
  if (options.ttlMinutes <= 0) {
    return;
  }

  const filePath = cacheFilePath(options);
  await assertWritablePathWithinProject(options.projectRoot, filePath, "Provider probe cache");
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await assertWritablePathWithinProject(options.projectRoot, filePath, "Provider probe cache");
  const cached: CachedProbeSample = {
    createdAt: new Date().toISOString(),
    sample: { ...sample, cached: false },
  };
  const serialized = JSON.stringify(cached, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CACHE_ENTRY_BYTES) return;
  await fs.writeFile(filePath, serialized, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600);
}

function cacheFilePath(options: ProbeCacheLookupOptions): string {
  const key = hashProbeOutput(
    `${options.providerId}\n${options.modelName}\n${options.model}\n${stableJson(options.parameters ?? {})}\n${options.probeId}\n${options.sampleIndex}\n${options.input}`,
  ).slice("sha256:".length);
  return path.join(options.projectRoot, ".aidrift", "cache", "probes", `${key}.json`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
