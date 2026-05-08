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

export type ProbeStatus = "PASS" | "DRIFT" | "ERROR" | "NEW";

export interface CanonicalProbe {
  readonly id: string;
  readonly category: ProbeCategory;
  readonly comparisonType: ProbeComparisonType;
  readonly input: string;
  readonly description: string;
  readonly threshold: number;
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
}

export type ProbeBaselineMap = Readonly<Record<string, ProbeBaseline>>;

export interface ProbeSample {
  readonly output: string;
  readonly latencyMs: number;
  readonly costUsd: number;
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
  readonly samples: readonly ProbeSample[];
}

export interface ProbeRunSummary {
  readonly total: number;
  readonly passed: number;
  readonly drifted: number;
  readonly errors: number;
  readonly new: number;
}

export interface ProbeRunResult {
  readonly providerId: string;
  readonly baselineSnapshotId?: string | undefined;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly results: readonly ProbeResult[];
  readonly summary: ProbeRunSummary;
  readonly hasDrift: boolean;
}

export interface RunProviderProbesOptions {
  readonly projectRoot: string;
  readonly models: readonly ProbeModelTarget[];
  readonly provider?: EvalProvider | undefined;
  readonly probeIds?: ReadonlySet<string> | undefined;
  readonly categories?: ReadonlySet<ProbeCategory> | undefined;
  readonly samples?: number | undefined;
  readonly cacheTtlMinutes?: number | undefined;
  readonly useCache?: boolean | undefined;
  readonly concurrency?: number | undefined;
  readonly baselineSnapshotId?: string | undefined;
}

export interface ProbeCostEstimate {
  readonly modelCount: number;
  readonly probeCount: number;
  readonly samples: number;
  readonly requestCount: number;
  readonly estimatedUsd: number;
}
