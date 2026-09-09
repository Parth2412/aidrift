import { AIDriftError, ExitCode } from "../errors.js";
import type { PlanRunResult } from "../eval/types.js";
import { containsSecretLikeValue } from "../manifest/security.js";
import type { ProbeRunResult } from "../probe/types.js";
import type { EvalSnapshotBaseline, ProbeSnapshotBaseline, Snapshot } from "./types.js";

export interface AttachBehavioralBaselinesOptions {
  readonly snapshot: Snapshot;
  readonly evalResult?: PlanRunResult | undefined;
  readonly probeResult?: ProbeRunResult | undefined;
}

export function attachBehavioralBaselines(options: AttachBehavioralBaselinesOptions): Snapshot {
  const evalBaselines =
    options.evalResult === undefined
      ? options.snapshot.eval
      : { baselines: buildEvalBaselines(options.snapshot, options.evalResult) };
  const probeBaselines =
    options.probeResult === undefined
      ? options.snapshot.probe
      : { baselines: buildProbeBaselines(options.snapshot, options.probeResult) };

  return {
    ...options.snapshot,
    eval: evalBaselines,
    probe: probeBaselines,
  };
}

function buildEvalBaselines(
  snapshot: Snapshot,
  result: PlanRunResult,
): Record<string, EvalSnapshotBaseline> {
  return Object.fromEntries(
    [...result.results]
      .sort((left, right) => left.assertionId.localeCompare(right.assertionId))
      .map((item) => {
        if (item.samples.length === 0) {
          throw baselineEvidenceError(`Eval assertion ${item.assertionId} has no samples.`);
        }
        for (const sample of item.samples) {
          assertEvidenceSafe(sample.output, `eval assertion ${item.assertionId}`);
        }
        return [
          item.assertionId,
          {
            score: item.score,
            providerId: item.providerId,
            ...(result.executionTarget === undefined
              ? {}
              : {
                  modelName: result.executionTarget.modelName,
                  model: result.executionTarget.model,
                  promptNames: result.executionTarget.promptNames,
                }),
            samples: item.samples.map((sample) => ({
              output: sample.output,
              score: sample.score,
              latencyMs: sample.latencyMs,
              ...(sample.costUsd !== undefined ? { costUsd: sample.costUsd } : {}),
            })),
            capturedAt: snapshot.timestamp,
            snapshotId: snapshot.id,
          },
        ];
      }),
  );
}

function buildProbeBaselines(
  snapshot: Snapshot,
  result: ProbeRunResult,
): Record<string, ProbeSnapshotBaseline> {
  return Object.fromEntries(
    [...result.results]
      .sort((left, right) =>
        `${left.modelName}/${left.probeId}`.localeCompare(`${right.modelName}/${right.probeId}`),
      )
      .map((item) => {
        const firstSample = item.samples[0];
        if (firstSample === undefined) {
          throw baselineEvidenceError(`Probe ${item.modelName}/${item.probeId} has no samples.`);
        }
        for (const sample of item.samples) {
          assertEvidenceSafe(sample.output, `probe ${item.modelName}/${item.probeId}`);
        }
        return [
          `${item.modelName}/${item.probeId}`,
          {
            output: firstSample.output,
            score: item.score,
            provider: item.provider,
            model: item.model,
            modelName: item.modelName,
            probeId: item.probeId,
            samples: item.samples.map((sample) => ({
              output: sample.output,
              latencyMs: sample.latencyMs,
              ...(sample.costUsd !== undefined ? { costUsd: sample.costUsd } : {}),
            })),
            capturedAt: snapshot.timestamp,
            snapshotId: snapshot.id,
          },
        ];
      }),
  );
}

function assertEvidenceSafe(output: string, source: string): void {
  if (containsSecretLikeValue(output)) {
    throw baselineEvidenceError(`Secret-like content was detected in ${source} output.`);
  }
}

function baselineEvidenceError(reason: string): AIDriftError {
  return new AIDriftError({
    code: "snapshot.baseline.invalid",
    exitCode: ExitCode.ConfigError,
    what: "Behavioral baseline evidence cannot be persisted safely.",
    why: reason,
    fix: "Remove secret-bearing output or fix the provider execution, then capture again.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}
