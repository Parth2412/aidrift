export type CheckExitCode = 0 | 1 | 2;
export type CheckStatus = "PASS" | "WARN" | "FAIL" | "NEW";
export type ProbeStatus = "PASS" | "WARN" | "DRIFT" | "INSUFFICIENT" | "ERROR" | "NEW";

export interface StatisticalEvidence {
  readonly method: "fisher_exact" | "welch_t";
  readonly pValue: number;
  readonly significanceLevel: number;
  readonly confidenceLevel: number;
  readonly confidenceInterval: readonly [number, number];
  readonly significant: boolean;
}

export interface AssertionStatistics extends StatisticalEvidence {
  readonly sampleCount: number;
  readonly baselineSampleCount: number;
  readonly standardDeviation: number;
  readonly baselineStandardDeviation: number;
}

export interface ScoreDistribution {
  readonly sampleCount: number;
  readonly mean: number;
  readonly standardDeviation: number;
}

export interface ProbeStatistics extends StatisticalEvidence {
  readonly current: ScoreDistribution;
  readonly baseline: ScoreDistribution;
  readonly delta: number;
}

export interface CheckEvidence {
  readonly schemaVersion: "3";
  readonly passed: boolean;
  readonly failOn: "fail" | "warn";
  readonly baselineSnapshotId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly execution: {
    readonly samples: number;
    readonly timeoutSeconds: number;
    readonly concurrency: number;
    readonly estimatedRequests: number;
    readonly estimatedInputTokens: number;
    readonly estimatedOutputTokens: number;
    readonly costEstimateKnown: boolean;
    readonly estimatedCostUsd?: number | undefined;
    readonly unknownModels?: readonly string[] | undefined;
    readonly observedCostUsd: number;
    readonly unknownObservedCostSamples: number;
    readonly pricingAsOf: string;
  };
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly warned: number;
    readonly failed: number;
    readonly new: number;
    readonly regressions: number;
  };
  readonly results: readonly {
    readonly assertionId: string;
    readonly type: "contains" | "regex" | "json_schema";
    readonly status: CheckStatus;
    readonly score: number;
    readonly baselineScore?: number | undefined;
    readonly providerId: string;
    readonly sampleCount: number;
    readonly latencyMs: number;
    readonly costUsd: number;
    readonly statistics?: AssertionStatistics | undefined;
    readonly explanation: string;
    readonly critical: boolean;
    readonly tags: readonly string[];
  }[];
  readonly probes: {
    readonly summary: {
      readonly total: number;
      readonly passed: number;
      readonly warned: number;
      readonly drifted: number;
      readonly insufficient: number;
      readonly errors: number;
      readonly new: number;
    };
    readonly results: readonly {
      readonly modelName: string;
      readonly provider: string;
      readonly model: string;
      readonly probeId: string;
      readonly category: "deterministic" | "structural" | "semantic" | "behavioral" | "performance";
      readonly status: ProbeStatus;
      readonly score: number;
      readonly baselineScore?: number | undefined;
      readonly sampleCount: number;
      readonly confidence: number;
      readonly explanation: string;
      readonly statistics?: ProbeStatistics | undefined;
    }[];
  };
  readonly artifacts: {
    readonly gate: "informational";
    readonly summary: {
      readonly total: number;
      readonly changed: number;
      readonly unchanged: number;
      readonly added: number;
      readonly removed: number;
    };
    readonly results: readonly {
      readonly artifactKey: string;
      readonly status: "unchanged" | "added" | "removed" | "modified";
      readonly kind: "text" | "binary" | "model";
    }[];
  };
}

export interface ActionInputs {
  readonly manifest: string;
  readonly baseline?: string | undefined;
  readonly failOn: "fail" | "warn";
  readonly assertions?: string | undefined;
  readonly tags?: string | undefined;
  readonly samples?: string | undefined;
  readonly probeModel?: string | undefined;
  readonly probeCategory?: string | undefined;
  readonly concurrency?: string | undefined;
  readonly timeout?: string | undefined;
  readonly costBudget?: string | undefined;
  readonly commentMode: "upsert" | "new" | "none";
  readonly githubToken?: string | undefined;
  readonly uploadArtifact: boolean;
  readonly artifactName: string;
  readonly retentionDays: number;
}

export interface AnnotationProperties {
  readonly file?: string | undefined;
  readonly startLine?: number | undefined;
  readonly title?: string | undefined;
}

export interface CoreAdapter {
  getInput(name: string): string;
  setOutput(name: string, value: string | number): void;
  setSecret(value: string): void;
  info(message: string): void;
  notice(message: string, properties?: AnnotationProperties): void;
  warning(message: string, properties?: AnnotationProperties): void;
  error(message: string, properties?: AnnotationProperties): void;
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecAdapter {
  run(command: string, args: readonly string[]): Promise<ExecResult>;
}

export interface ArtifactUploadResult {
  readonly id?: number | undefined;
}

export interface ArtifactAdapter {
  upload(
    name: string,
    files: readonly string[],
    rootDirectory: string,
    retentionDays: number,
  ): Promise<ArtifactUploadResult>;
}

export interface PullRequestContext {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
  readonly headRepository: string;
}

export interface ActionContext {
  readonly eventName: string;
  readonly runId: number;
  readonly serverUrl: string;
  readonly repository: { readonly owner: string; readonly repository: string };
  readonly pullRequest?: PullRequestContext | undefined;
}

export interface IssueComment {
  readonly id: number;
  readonly body?: string | null | undefined;
  readonly user?:
    | { readonly login?: string | undefined; readonly type?: string | undefined }
    | null
    | undefined;
}

export interface CommentAdapter {
  list(owner: string, repository: string, issueNumber: number): Promise<readonly IssueComment[]>;
  create(owner: string, repository: string, issueNumber: number, body: string): Promise<void>;
  update(owner: string, repository: string, commentId: number, body: string): Promise<void>;
}

export interface ActionDependencies {
  readonly core: CoreAdapter;
  readonly exec: ExecAdapter;
  readonly artifact: ArtifactAdapter;
  readonly context: ActionContext;
  readonly createCommentAdapter: (token: string) => CommentAdapter;
  readonly cliPath: string;
  readonly temporaryDirectory: string;
}
