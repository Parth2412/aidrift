import { AIDriftError, ExitCode } from "../errors.js";
import { MAX_PROVIDER_OUTPUT_BYTES, MAX_RUN_OUTPUT_BYTES } from "../eval/limits.js";
import type { ProviderOutput } from "./types.js";

type EvidenceScope = "eval" | "probe";

export class ProviderOutputBudget {
  private totalBytes = 0;
  private stoppedReason: AIDriftError | undefined;

  constructor(private readonly scope: EvidenceScope) {}

  assertCanContinue(): void {
    if (this.stoppedReason !== undefined) throw this.stoppedReason;
  }

  validateAndRecord(value: unknown, evidenceId: string): ProviderOutput {
    this.assertCanContinue();
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw this.stop(evidenceId, "The provider returned a non-object result.");
    }

    const output = value as Partial<ProviderOutput>;
    if (typeof output.content !== "string") {
      throw this.stop(evidenceId, "The provider output content is not a string.");
    }
    if (
      typeof output.latencyMs !== "number" ||
      !Number.isFinite(output.latencyMs) ||
      output.latencyMs < 0
    ) {
      throw this.stop(evidenceId, "The provider latency is not a finite non-negative number.");
    }
    if (
      output.costUsd !== undefined &&
      (typeof output.costUsd !== "number" || !Number.isFinite(output.costUsd) || output.costUsd < 0)
    ) {
      throw this.stop(evidenceId, "The provider cost is not a finite non-negative number.");
    }

    const outputBytes = Buffer.byteLength(output.content, "utf8");
    if (outputBytes > MAX_PROVIDER_OUTPUT_BYTES) {
      throw this.stop(
        evidenceId,
        `One provider output exceeds the ${MAX_PROVIDER_OUTPUT_BYTES}-byte limit.`,
      );
    }
    const nextTotal = this.totalBytes + outputBytes;
    if (nextTotal > MAX_RUN_OUTPUT_BYTES) {
      throw this.stop(
        evidenceId,
        `Retained provider output exceeds the ${MAX_RUN_OUTPUT_BYTES}-byte aggregate run limit.`,
      );
    }
    this.totalBytes = nextTotal;
    return output as ProviderOutput;
  }

  private stop(evidenceId: string, reason: string): AIDriftError {
    this.stoppedReason ??= new AIDriftError({
      code: `${this.scope}.output.invalid`,
      exitCode: ExitCode.ConfigError,
      what: `Provider output cannot be retained safely for ${evidenceId}.`,
      why: reason,
      fix: "Correct the provider implementation or reduce generated output before retrying.",
      docs: "https://github.com/Parth2412/aidrift#readme",
    });
    return this.stoppedReason;
  }
}
