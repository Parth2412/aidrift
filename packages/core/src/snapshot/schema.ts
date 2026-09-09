import { Ajv2020 } from "ajv/dist/2020.js";

import { AIDriftError, ExitCode } from "../errors.js";
import { structuredValueLimitViolation } from "../files/structured-value.js";
import { containsSecretLikeValue } from "../manifest/security.js";
import { hashString } from "./hasher.js";
import type { Snapshot } from "./types.js";

const MAX_SNAPSHOT_NODES = 2_000_000;
const MAX_SNAPSHOT_DEPTH = 64;
const MAX_SNAPSHOT_COLLECTION_ENTRIES = 10_000;
const MAX_ARTIFACTS = 10_000;
const MAX_EVAL_BASELINES = 10_000;
const MAX_PROBE_BASELINES = 2_000;
const MAX_BASELINE_SAMPLES = 100;
const MAX_ARTIFACT_CONTENT_CHARACTERS = 10 * 1024 * 1024;
const MAX_PROVIDER_OUTPUT_CHARACTERS = 5 * 1024 * 1024;
const MAX_ARTIFACT_CONTENT_BYTES = 10 * 1024 * 1024;
const MAX_SNAPSHOT_ARTIFACT_CONTENT_BYTES = 64 * 1024 * 1024;
const MAX_PROVIDER_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_SNAPSHOT_PROVIDER_OUTPUT_BYTES = 32 * 1024 * 1024;
const SHA256_PATTERN = "^sha256:[a-f0-9]{64}$";

export const SNAPSHOT_SCHEMA = {
  $id: "https://aidrift.dev/schemas/snapshot.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "timestamp", "manifestHash", "artifacts", "metadata"],
  properties: {
    schemaVersion: { const: "1" },
    id: { type: "string", pattern: "^snap_[A-Za-z0-9][A-Za-z0-9_-]{0,123}$" },
    label: { type: "string", maxLength: 256 },
    message: { type: "string", maxLength: 8_192 },
    tags: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 128 },
      uniqueItems: true,
    },
    timestamp: { type: "string", minLength: 1, maxLength: 64 },
    manifestHash: { type: "string", pattern: SHA256_PATTERN },
    artifacts: {
      type: "object",
      maxProperties: MAX_ARTIFACTS,
      propertyNames: { maxLength: 512 },
      additionalProperties: { $ref: "#/$defs/artifact" },
    },
    eval: {
      type: "object",
      additionalProperties: false,
      properties: {
        baselines: {
          type: "object",
          maxProperties: MAX_EVAL_BASELINES,
          propertyNames: { maxLength: 512 },
          additionalProperties: { $ref: "#/$defs/evalBaseline" },
        },
      },
    },
    probe: {
      type: "object",
      additionalProperties: false,
      properties: {
        baselines: {
          type: "object",
          maxProperties: MAX_PROBE_BASELINES,
          propertyNames: { maxLength: 512 },
          additionalProperties: { $ref: "#/$defs/probeBaseline" },
        },
      },
    },
    metadata: { $ref: "#/$defs/metadata" },
  },
  $defs: {
    artifact: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "hash"],
      properties: {
        kind: { enum: ["text", "binary", "model"] },
        hash: { type: "string", pattern: SHA256_PATTERN },
        sizeBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        content: { type: "string", maxLength: MAX_ARTIFACT_CONTENT_CHARACTERS },
        contentType: { enum: ["text", "json", "yaml"] },
        provider: { type: "string", minLength: 1, maxLength: 256 },
        model: { type: "string", minLength: 1, maxLength: 512 },
        parameters: { type: "object", maxProperties: 10_000, additionalProperties: true },
        path: { type: "string", minLength: 1, maxLength: 4_096 },
        lastModified: { type: "string", minLength: 1, maxLength: 64 },
      },
    },
    evalBaseline: {
      type: "object",
      additionalProperties: false,
      required: ["score"],
      properties: {
        score: { type: "number", minimum: 0, maximum: 1 },
        providerId: { type: "string", minLength: 1, maxLength: 256 },
        modelName: { type: "string", minLength: 1, maxLength: 512 },
        model: { type: "string", minLength: 1, maxLength: 512 },
        promptNames: {
          type: "array",
          maxItems: 1_000,
          items: { type: "string", minLength: 1, maxLength: 512 },
          uniqueItems: true,
        },
        samples: {
          type: "array",
          minItems: 1,
          maxItems: MAX_BASELINE_SAMPLES,
          items: { $ref: "#/$defs/evalBaselineSample" },
        },
        capturedAt: { type: "string", minLength: 1, maxLength: 64 },
        snapshotId: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    evalBaselineSample: {
      type: "object",
      additionalProperties: false,
      required: ["output", "score", "latencyMs"],
      properties: {
        output: { type: "string", maxLength: MAX_PROVIDER_OUTPUT_CHARACTERS },
        score: { type: "number", minimum: 0, maximum: 1 },
        latencyMs: { type: "number", minimum: 0, maximum: 3_600_000 },
        costUsd: { type: "number", minimum: 0, maximum: 1_000_000 },
      },
    },
    probeBaseline: {
      type: "object",
      additionalProperties: false,
      required: ["output"],
      properties: {
        output: { type: "string", maxLength: MAX_PROVIDER_OUTPUT_CHARACTERS },
        score: { type: "number", minimum: 0, maximum: 1 },
        provider: { type: "string", minLength: 1, maxLength: 256 },
        model: { type: "string", minLength: 1, maxLength: 512 },
        modelName: { type: "string", minLength: 1, maxLength: 512 },
        probeId: { type: "string", minLength: 1, maxLength: 512 },
        samples: {
          type: "array",
          minItems: 1,
          maxItems: MAX_BASELINE_SAMPLES,
          items: { $ref: "#/$defs/probeBaselineSample" },
        },
        capturedAt: { type: "string", minLength: 1, maxLength: 64 },
        snapshotId: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    probeBaselineSample: {
      type: "object",
      additionalProperties: false,
      required: ["output", "latencyMs"],
      properties: {
        output: { type: "string", maxLength: MAX_PROVIDER_OUTPUT_CHARACTERS },
        latencyMs: { type: "number", minimum: 0, maximum: 3_600_000 },
        costUsd: { type: "number", minimum: 0, maximum: 1_000_000 },
      },
    },
    metadata: {
      type: "object",
      additionalProperties: false,
      required: ["cliVersion", "nodeVersion", "os"],
      properties: {
        gitCommit: { type: "string", maxLength: 512 },
        gitBranch: { type: "string", maxLength: 512 },
        gitDirty: { type: "boolean" },
        cliVersion: { type: "string", minLength: 1, maxLength: 128 },
        nodeVersion: { type: "string", minLength: 1, maxLength: 128 },
        os: { type: "string", minLength: 1, maxLength: 256 },
      },
    },
  },
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSnapshotSchema = ajv.compile(SNAPSHOT_SCHEMA);

export function parseSnapshotJson(source: string, sourcePath: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    throw corruptSnapshotError(sourcePath, "The file is not valid JSON.", cause);
  }
  return assertSnapshotValid(parsed, sourcePath);
}

export function assertSnapshotValid(value: unknown, sourcePath: string): Snapshot {
  const complexityViolation = structuredValueLimitViolation(value, {
    maximumNodes: MAX_SNAPSHOT_NODES,
    maximumDepth: MAX_SNAPSHOT_DEPTH,
    maximumCollectionEntries: MAX_SNAPSHOT_COLLECTION_ENTRIES,
  });
  if (complexityViolation !== undefined) {
    throw corruptSnapshotError(sourcePath, complexityViolation);
  }
  if (!validateSnapshotSchema(value)) {
    const reason = (validateSnapshotSchema.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
      .join("; ");
    throw corruptSnapshotError(sourcePath, `Schema validation failed: ${reason}`);
  }

  const snapshot = value as Snapshot;
  assertSnapshotContentSafe(snapshot, sourcePath);
  if (!Number.isFinite(Date.parse(snapshot.timestamp))) {
    throw corruptSnapshotError(sourcePath, "timestamp is not a valid ISO-8601 date.");
  }
  for (const [assertionId, baseline] of Object.entries(snapshot.eval?.baselines ?? {})) {
    if (baseline.samples === undefined) continue;
    const mean =
      baseline.samples.reduce((total, sample) => total + sample.score, 0) / baseline.samples.length;
    if (Math.abs(mean - baseline.score) > 1e-6) {
      throw corruptSnapshotError(
        sourcePath,
        `eval baseline ${assertionId} score does not match its sample distribution mean.`,
      );
    }
  }
  return snapshot;
}

function assertSnapshotContentSafe(snapshot: Snapshot, sourcePath: string): void {
  let artifactContentBytes = 0;
  let providerOutputBytes = 0;

  for (const [artifactName, artifact] of Object.entries(snapshot.artifacts)) {
    if (artifact.content === undefined) continue;
    const contentBytes = Buffer.byteLength(artifact.content, "utf8");
    if (contentBytes > MAX_ARTIFACT_CONTENT_BYTES) {
      throw corruptSnapshotError(
        sourcePath,
        `artifact ${artifactName} exceeds the ${MAX_ARTIFACT_CONTENT_BYTES}-byte content limit.`,
      );
    }
    artifactContentBytes += contentBytes;
    if (artifactContentBytes > MAX_SNAPSHOT_ARTIFACT_CONTENT_BYTES) {
      throw corruptSnapshotError(
        sourcePath,
        `artifact content exceeds the ${MAX_SNAPSHOT_ARTIFACT_CONTENT_BYTES}-byte aggregate limit.`,
      );
    }
    if (artifact.kind === "text" && artifact.hash !== hashString(artifact.content)) {
      throw corruptSnapshotError(
        sourcePath,
        `text artifact ${artifactName} content does not match its recorded hash.`,
      );
    }
    if (artifact.sizeBytes !== undefined && artifact.sizeBytes !== contentBytes) {
      throw corruptSnapshotError(
        sourcePath,
        `text artifact ${artifactName} content does not match its recorded size.`,
      );
    }
  }

  const reserveProviderOutput = (output: string, evidenceId: string): void => {
    const outputBytes = Buffer.byteLength(output, "utf8");
    if (outputBytes > MAX_PROVIDER_OUTPUT_BYTES) {
      throw corruptSnapshotError(
        sourcePath,
        `${evidenceId} exceeds the ${MAX_PROVIDER_OUTPUT_BYTES}-byte output limit.`,
      );
    }
    providerOutputBytes += outputBytes;
    if (providerOutputBytes > MAX_SNAPSHOT_PROVIDER_OUTPUT_BYTES) {
      throw corruptSnapshotError(
        sourcePath,
        `behavioral output exceeds the ${MAX_SNAPSHOT_PROVIDER_OUTPUT_BYTES}-byte aggregate limit.`,
      );
    }
  };

  for (const [assertionId, baseline] of Object.entries(snapshot.eval?.baselines ?? {})) {
    for (const sample of baseline.samples ?? []) {
      reserveProviderOutput(sample.output, `eval baseline ${assertionId}`);
    }
  }
  for (const [probeId, baseline] of Object.entries(snapshot.probe?.baselines ?? {})) {
    reserveProviderOutput(baseline.output, `probe baseline ${probeId}`);
    for (const sample of baseline.samples ?? []) {
      reserveProviderOutput(sample.output, `probe baseline ${probeId}`);
    }
  }

  if (containsSecretInStructuredValue(snapshot)) {
    throw corruptSnapshotError(
      sourcePath,
      "Secret-like content was detected in snapshot evidence.",
    );
  }
}

function containsSecretInStructuredValue(value: unknown): boolean {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string" && containsSecretLikeValue(current)) return true;
    if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current !== null && typeof current === "object") {
      stack.push(...Object.values(current as Record<string, unknown>));
    }
  }
  return false;
}

function corruptSnapshotError(sourcePath: string, reason: string, cause?: unknown): AIDriftError {
  return new AIDriftError({
    code: "snapshot.corrupt",
    exitCode: ExitCode.ConfigError,
    what: `Snapshot is corrupt or incompatible: ${sourcePath}`,
    why: reason,
    fix: "Restore or remove the invalid snapshot file, then capture a new baseline.",
    docs: "https://github.com/Parth2412/aidrift#readme",
    cause,
  });
}
