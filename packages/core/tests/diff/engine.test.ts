import { describe, expect, it } from "vitest";

import { diffSnapshots } from "../../src/diff/engine.js";
import type { Snapshot, SnapshotArtifact } from "../../src/snapshot/types.js";

describe("diffSnapshots", () => {
  it("treats formatting-only JSON changes as semantically unchanged", () => {
    const result = diffSnapshots(
      snapshot("snap_a", {
        "tools/schema": textArtifact('{"b":2,"a":1}', "json", "sha256:a"),
      }),
      snapshot("snap_b", {
        "tools/schema": textArtifact('{\n  "a": 1,\n  "b": 2\n}\n', "json", "sha256:b"),
      }),
    );

    expect(result.changedCount).toBe(0);
    expect(result.artifacts[0]).toMatchObject({ status: "unchanged", hashA: "sha256:a" });
  });

  it("reports nested YAML changes as semantic key paths", () => {
    const result = diffSnapshots(
      snapshot("snap_a", {
        "rag/config": textArtifact("retrieval:\n  top_k: 4\n", "yaml", "sha256:a"),
      }),
      snapshot("snap_b", {
        "rag/config": textArtifact("retrieval:\n  top_k: 8\n", "yaml", "sha256:b"),
      }),
    );

    expect(result.artifacts[0]).toMatchObject({
      status: "modified",
      jsonDiff: [{ key: "retrieval.top_k", status: "modified", valueA: 4, valueB: 8 }],
    });
  });

  it("sorts artifact keys and reports additions, removals, and model parameters", () => {
    const result = diffSnapshots(
      snapshot("snap_a", {
        "prompts/removed": textArtifact("old", "text", "sha256:old"),
        "models/primary": {
          kind: "model",
          hash: "sha256:model-old",
          provider: "mock",
          model: "mock-v1",
          parameters: { temperature: 0.1 },
        },
      }),
      snapshot("snap_b", {
        "tools/added": textArtifact("new", "text", "sha256:new"),
        "models/primary": {
          kind: "model",
          hash: "sha256:model-new",
          provider: "mock",
          model: "mock-v2",
          parameters: { temperature: 0.2 },
        },
      }),
    );

    expect(result.artifacts.map((artifact) => artifact.artifactKey)).toEqual([
      "models/primary",
      "prompts/removed",
      "tools/added",
    ]);
    expect(result).toMatchObject({ changedCount: 3, addedCount: 1, removedCount: 1 });
    expect(result.artifacts[0]?.paramDiff).toEqual(
      expect.arrayContaining([
        { param: "model", status: "modified", valueA: "mock-v1", valueB: "mock-v2" },
        { param: "temperature", status: "modified", valueA: 0.1, valueB: 0.2 },
      ]),
    );
  });

  it("falls back to a text diff when structured content is malformed", () => {
    const result = diffSnapshots(
      snapshot("snap_a", {
        "tools/schema": textArtifact("{", "json", "sha256:a"),
      }),
      snapshot("snap_b", {
        "tools/schema": textArtifact("{}", "json", "sha256:b"),
      }),
    );

    expect(result.artifacts[0]?.textDiff).toContain("-{");
    expect(result.artifacts[0]?.jsonDiff).toBeUndefined();
  });
});

function snapshot(id: string, artifacts: Record<string, SnapshotArtifact>): Snapshot {
  return {
    schemaVersion: "1",
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    manifestHash: "sha256:manifest",
    artifacts,
    metadata: { cliVersion: "0.0.0", nodeVersion: process.version, os: "linux" },
  };
}

function textArtifact(
  content: string,
  contentType: "text" | "json" | "yaml",
  hash: string,
): SnapshotArtifact {
  return { kind: "text", hash, content, contentType };
}
