import type { RegressionStatistics } from "../eval/statistics.js";
import type { EvalProvider } from "../providers/types.js";

export type ProbeCategory =
  | "deterministic"
  | "structural"
  | "semantic"
  | "behavioral"
  | "performance";

export type ProbeComparisonType =
  | "exact"
  | "structural"
  | "semantic"
  | "behavioral"
  | "performance";

export type ProbeStatus = "PASS" | "WARN" | "DRIFT" | "INSUFFICIENT" | "ERROR" | "NEW";

export type ProbeStructuralRule =
  | "json_object_name_status"
  | "json_array_red_green_blue"
  | "numbered_list_three"
  | "xml_result_ok";

export interface ProbeRubricConcept {
  readonly label: string;
  /** Case-insensitive regular-expression sources. */
  readonly anyOf: readonly string[];
}

export interface ProbeRubric {
  readonly required: readonly ProbeRubricConcept[];
  /** A match makes the sample fail the rubric. */
  readonly forbidden?: readonly string[] | undefined;
}

export interface CanonicalProbe {
  readonly id: string;
  readonly category: ProbeCategory;
  readonly comparisonType: ProbeComparisonType;
  readonly input: string;
  readonly description: string;
  readonly threshold: number;
  readonly structuralRule?: ProbeStructuralRule | undefined;
  readonly rubric?: ProbeRubric | undefined;
}

export interface ProbeModelTarget {
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly parameters?: Record<string, unknown> | undefined;
}

export interface ProbeBaseline {
  readonly output: string;
  readonly score: number;
  readonly capturedAt: string;
  readonly snapshotId?: string | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly probeId?: string | undefined;
  readonly samples: readonly ProbeBaselineSample[];
}

export interface ProbeBaselineSample {
  readonly output: string;
  readonly latencyMs?: number | undefined;
  readonly costUsd?: number | undefined;
}

export type ProbeBaselineMap = Readonly<Record<string, ProbeBaseline>>;

export interface ProbeSample {
  readonly output: string;
  readonly latencyMs: number;
  readonly costUsd?: number | undefined;
  readonly cached: boolean;
}

export interface ProbeResult {
  readonly modelName: string;
  readonly provider: string;
  readonly model: string;
  readonly probeId: string;
  readonly category: ProbeCategory;
  readonly status: ProbeStatus;
  readonly score: number;
  readonly baselineScore?: number | undefined;
  readonly confidence: number;
  readonly explanation: string;
  readonly statistics?: RegressionStatistics | undefined;
  readonly samples: readonly ProbeSample[];
}

export interface ProbeRunSummary {
  readonly total: number;
  readonly passed: number;
  readonly warned: number;
  readonly drifted: number;
  readonly insufficient: number;
  readonly errors: number;
  readonly new: number;
}

export interface ProbeRunResult {
  readonly providerId: string;
  readonly baselineSnapshotId?: string | undefined;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly requestedSamples: number;
  readonly totalCostUsd: number;
  readonly unknownCostSamples: number;
  readonly results: readonly ProbeResult[];
  readonly summary: ProbeRunSummary;
  readonly hasDrift: boolean;
}

export interface RunProviderProbesOptions {
  readonly projectRoot: string;
  readonly models: readonly ProbeModelTarget[];
  readonly provider?: EvalProvider | undefined;
  readonly providerForModel?: ((model: ProbeModelTarget) => EvalProvider) | undefined;
  readonly probeIds?: ReadonlySet<string> | undefined;
  readonly categories?: ReadonlySet<ProbeCategory> | undefined;
  readonly samples?: number | undefined;
  readonly significanceLevel?: number | undefined;
  readonly cacheTtlMinutes?: number | undefined;
  readonly useCache?: boolean | undefined;
  readonly concurrency?: number | undefined;
  /** Total wall-clock deadline for the complete probe run. */
  readonly timeoutMs?: number | undefined;
  /** Observed-cost ceiling. When set, unknown cost fails closed. */
  readonly budgetUsd?: number | undefined;
  readonly baselineSnapshotId?: string | undefined;
  readonly storagePath?: string | undefined;
  /** Explicitly permits test/offline providers to run against a differently declared artifact. */
  readonly allowProviderOverride?: boolean | undefined;
}

export interface ProbeCostEstimate {
  readonly modelCount: number;
  readonly probeCount: number;
  readonly samples: number;
  readonly requestCount: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedUsd?: number | undefined;
  readonly unknownModels: readonly string[];
  readonly pricingAsOf: string;
}
