import fs from "node:fs/promises";
import path from "node:path";

import { hashProbeOutput } from "./comparator.js";
import type { ProbeSample } from "./types.js";

interface CachedProbeSample {
  readonly createdAt: string;
  readonly sample: ProbeSample;
}

export interface ProbeCacheLookupOptions {
  readonly projectRoot: string;
  readonly modelName: string;
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
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  try {
    const cached = JSON.parse(raw) as CachedProbeSample;
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

export async function writeCachedProbeSample(
  options: ProbeCacheLookupOptions,
  sample: ProbeSample,
): Promise<void> {
  if (options.ttlMinutes <= 0) {
    return;
  }

  const filePath = cacheFilePath(options);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const cached: CachedProbeSample = {
    createdAt: new Date().toISOString(),
    sample: { ...sample, cached: false },
  };
  await fs.writeFile(filePath, JSON.stringify(cached, null, 2), "utf8");
}

function cacheFilePath(options: ProbeCacheLookupOptions): string {
  const key = hashProbeOutput(
    `${options.providerId}\n${options.modelName}\n${options.probeId}\n${options.sampleIndex}\n${options.input}`,
  ).slice("sha256:".length);
  return path.join(options.projectRoot, ".aidrift", "cache", "probes", `${key}.json`);
}
