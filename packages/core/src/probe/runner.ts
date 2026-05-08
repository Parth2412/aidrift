import { performance } from "node:perf_hooks";

import { createMockProvider } from "../providers/mock-provider.js";
import {
  loadLatestProbeBaselines,
  loadProbeBaselinesForSnapshot,
  probeBaselineKey,
} from "./baselines.js";
import { readCachedProbeSample, writeCachedProbeSample } from "./cache.js";
import { BUILT_IN_PROBES } from "./canonical.js";
import { compareProbeOutput } from "./comparator.js";
import type {
  CanonicalProbe,
  ProbeResult,
  ProbeRunResult,
  ProbeRunSummary,
  ProbeSample,
  RunProviderProbesOptions,
} from "./types.js";

export async function runProviderProbes(
  options: RunProviderProbesOptions,
): Promise<ProbeRunResult> {
  const startedAt = new Date();
  const startMs = performance.now();
  const provider = options.provider ?? createMockProvider();
  const samples = Math.max(1, options.samples ?? 5);
  const cacheTtlMinutes =
    options.useCache === false ? 0 : Math.max(0, options.cacheTtlMinutes ?? 60);
  const probes = filterProbes(options);
  const loadedBaselines =
    options.baselineSnapshotId === undefined
      ? await loadLatestProbeBaselines(options.projectRoot)
      : await loadProbeBaselinesForSnapshot(options.projectRoot, options.baselineSnapshotId);

  const workItems = options.models.flatMap((model) =>
    probes.map((probe) => ({
      model,
      probe,
    })),
  );

  const results = await mapWithConcurrency(
    workItems,
    Math.max(1, options.concurrency ?? 4),
    async ({ model, probe }) => {
      const baseline = loadedBaselines.baselines[probeBaselineKey(model.name, probe.id)];
      const probeSamples: ProbeSample[] = [];

      try {
        for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
          const cached = await readCachedProbeSample({
            projectRoot: options.projectRoot,
            modelName: model.name,
            providerId: provider.id,
            probeId: probe.id,
            input: probe.input,
            sampleIndex,
            ttlMinutes: cacheTtlMinutes,
          });

          if (cached !== undefined) {
            probeSamples.push(cached);
            continue;
          }

          const output = await provider.generate({
            input: probe.input,
            probeId: probe.id,
            modelName: model.name,
          });
          const sample: ProbeSample = {
            output: output.content,
            latencyMs: output.latencyMs,
            costUsd: output.costUsd ?? 0,
            cached: false,
          };
          probeSamples.push(sample);
          await writeCachedProbeSample(
            {
              projectRoot: options.projectRoot,
              modelName: model.name,
              providerId: provider.id,
              probeId: probe.id,
              input: probe.input,
              sampleIndex,
              ttlMinutes: cacheTtlMinutes,
            },
            sample,
          );
        }

        const firstSample = probeSamples[0];
        const comparison = compareProbeOutput(probe, firstSample?.output ?? "", baseline);
        return {
          modelName: model.name,
          provider: model.provider,
          model: model.model,
          probeId: probe.id,
          category: probe.category,
          status: comparison.status,
          score: comparison.score,
          baselineScore: baseline?.score,
          confidence: comparison.confidence,
          explanation: comparison.explanation,
          samples: probeSamples,
        } satisfies ProbeResult;
      } catch (error) {
        return {
          modelName: model.name,
          provider: model.provider,
          model: model.model,
          probeId: probe.id,
          category: probe.category,
          status: "ERROR",
          score: 0,
          baselineScore: baseline?.score,
          confidence: 0,
          explanation: error instanceof Error ? error.message : "Probe execution failed.",
          samples: probeSamples,
        } satisfies ProbeResult;
      }
    },
  );

  const sortedResults = [...results].sort((left, right) =>
    `${left.modelName}/${left.probeId}`.localeCompare(`${right.modelName}/${right.probeId}`),
  );
  const summary = summarizeProbeResults(sortedResults);

  return {
    providerId: provider.id,
    baselineSnapshotId: loadedBaselines.snapshotId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startMs),
    results: sortedResults,
    summary,
    hasDrift: summary.drifted > 0,
  };
}

function filterProbes(options: RunProviderProbesOptions): readonly CanonicalProbe[] {
  return BUILT_IN_PROBES.filter((probe) => {
    if (options.probeIds !== undefined && !options.probeIds.has(probe.id)) {
      return false;
    }

    if (options.categories !== undefined && !options.categories.has(probe.category)) {
      return false;
    }

    return true;
  });
}

function summarizeProbeResults(results: readonly ProbeResult[]): ProbeRunSummary {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === "PASS").length,
    drifted: results.filter((result) => result.status === "DRIFT").length,
    errors: results.filter((result) => result.status === "ERROR").length,
    new: results.filter((result) => result.status === "NEW").length,
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) {
        return;
      }
      results[currentIndex] = await worker(item);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => runWorker()));
  return results;
}
