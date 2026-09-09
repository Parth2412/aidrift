import type { ActionContext, CheckEvidence, CoreAdapter } from "../src/types.js";

export function passingEvidence(overrides: Partial<CheckEvidence> = {}): CheckEvidence {
  return {
    schemaVersion: "3",
    passed: true,
    failOn: "fail",
    baselineSnapshotId: "snap_baseline",
    startedAt: "2026-09-08T00:00:00.000Z",
    completedAt: "2026-09-08T00:00:00.010Z",
    durationMs: 10,
    execution: {
      samples: 1,
      timeoutSeconds: 30,
      concurrency: 4,
      estimatedRequests: 2,
      estimatedInputTokens: 20,
      estimatedOutputTokens: 20,
      costEstimateKnown: true,
      estimatedCostUsd: 0,
      observedCostUsd: 0,
      unknownObservedCostSamples: 0,
      pricingAsOf: "2026-09-08",
    },
    summary: { total: 1, passed: 1, warned: 0, failed: 0, new: 0, regressions: 0 },
    results: [
      {
        assertionId: "safe-output",
        type: "contains",
        status: "PASS",
        score: 1,
        baselineScore: 1,
        providerId: "mock",
        sampleCount: 1,
        latencyMs: 10,
        costUsd: 0,
        explanation: "Stable.",
        critical: false,
        tags: ["smoke"],
      },
    ],
    probes: {
      summary: {
        total: 1,
        passed: 1,
        warned: 0,
        drifted: 0,
        insufficient: 0,
        errors: 0,
        new: 0,
      },
      results: [
        {
          modelName: "primary",
          provider: "mock",
          model: "mock-v1",
          probeId: "deterministic_math",
          category: "deterministic",
          status: "PASS",
          score: 1,
          baselineScore: 1,
          sampleCount: 1,
          confidence: 1,
          explanation: "Stable.",
        },
      ],
    },
    artifacts: {
      gate: "informational",
      summary: { total: 1, changed: 0, unchanged: 1, added: 0, removed: 0 },
      results: [{ artifactKey: "models/primary", status: "unchanged", kind: "model" }],
    },
    ...overrides,
  };
}

export function createCore(inputs: Readonly<Record<string, string>> = {}): {
  readonly core: CoreAdapter;
  readonly outputs: Map<string, string | number>;
  readonly errors: string[];
  readonly warnings: string[];
  readonly notices: string[];
  readonly secrets: string[];
} {
  const outputs = new Map<string, string | number>();
  const errors: string[] = [];
  const warnings: string[] = [];
  const notices: string[] = [];
  const secrets: string[] = [];
  return {
    core: {
      getInput: (name) => inputs[name] ?? "",
      setOutput: (name, value) => outputs.set(name, value),
      setSecret: (value) => secrets.push(value),
      info: () => undefined,
      notice: (message) => notices.push(message),
      warning: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
    outputs,
    errors,
    warnings,
    notices,
    secrets,
  };
}

export function pushContext(): ActionContext {
  return {
    eventName: "push",
    runId: 123,
    serverUrl: "https://github.example",
    repository: { owner: "owner", repository: "repo" },
  };
}
