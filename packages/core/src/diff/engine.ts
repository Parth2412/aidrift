import { diffBinary } from "./binary.js";
import { diffJson } from "./json.js";
import { diffParameters } from "./parameters.js";
import { diffText } from "./text.js";
import type { ArtifactDiffResult, DiffStatus, SnapshotDiffResult } from "./types.js";
import type { Snapshot, SnapshotArtifact } from "../snapshot/types.js";
import { parse as parseYaml } from "yaml";

function diffArtifact(
  key: string,
  artifactA: SnapshotArtifact | undefined,
  artifactB: SnapshotArtifact | undefined,
): ArtifactDiffResult {
  if (artifactA === undefined && artifactB !== undefined) {
    return { artifactKey: key, status: "added", kind: artifactB.kind, hashB: artifactB.hash };
  }
  if (artifactA !== undefined && artifactB === undefined) {
    return { artifactKey: key, status: "removed", kind: artifactA.kind, hashA: artifactA.hash };
  }
  if (artifactA === undefined || artifactB === undefined) {
    return { artifactKey: key, status: "unchanged", kind: "text" };
  }

  const hashStatus: DiffStatus = artifactA.hash === artifactB.hash ? "unchanged" : "modified";

  if (hashStatus === "unchanged") {
    return {
      artifactKey: key,
      status: "unchanged",
      kind: artifactA.kind,
      hashA: artifactA.hash,
      hashB: artifactB.hash,
    };
  }

  if (artifactA.kind !== artifactB.kind) {
    return {
      artifactKey: key,
      status: "modified",
      kind: artifactB.kind,
      hashA: artifactA.hash,
      hashB: artifactB.hash,
    };
  }

  if (artifactA.kind === "text" && artifactB.kind === "text") {
    const structuredA = parseStructuredArtifact(artifactA);
    const structuredB = parseStructuredArtifact(artifactB);
    if (structuredA.ok && structuredB.ok) {
      const jsonDiff = diffJson(structuredA.value, structuredB.value);
      if (jsonDiff.length === 0) {
        return {
          artifactKey: key,
          status: "unchanged",
          kind: "text",
          hashA: artifactA.hash,
          hashB: artifactB.hash,
        };
      }
      return {
        artifactKey: key,
        status: "modified",
        kind: "text",
        hashA: artifactA.hash,
        hashB: artifactB.hash,
        jsonDiff,
      };
    }

    const textDiff = diffText(artifactA.content ?? "", artifactB.content ?? "");
    return {
      artifactKey: key,
      status: "modified",
      kind: "text",
      hashA: artifactA.hash,
      hashB: artifactB.hash,
      textDiff: textDiff ?? undefined,
    };
  }

  if (artifactA.kind === "model" && artifactB.kind === "model") {
    const paramDiff = diffParameters(artifactA.parameters ?? {}, artifactB.parameters ?? {});
    const modelIdDiff = diffJson(
      { provider: artifactA.provider, model: artifactA.model },
      { provider: artifactB.provider, model: artifactB.model },
    );
    return {
      artifactKey: key,
      status: "modified",
      kind: "model",
      hashA: artifactA.hash,
      hashB: artifactB.hash,
      paramDiff: [
        ...modelIdDiff.map((e) => ({
          param: e.key,
          status: e.status,
          valueA: e.valueA,
          valueB: e.valueB,
        })),
        ...paramDiff,
      ],
    };
  }

  // binary
  const binaryStatus = diffBinary(artifactA.hash, artifactB.hash);
  return {
    artifactKey: key,
    status: binaryStatus,
    kind: "binary",
    hashA: artifactA.hash,
    hashB: artifactB.hash,
  };
}

export function diffSnapshots(snapshotA: Snapshot, snapshotB: Snapshot): SnapshotDiffResult {
  const allKeys = new Set([
    ...Object.keys(snapshotA.artifacts),
    ...Object.keys(snapshotB.artifacts),
  ]);

  const artifacts: ArtifactDiffResult[] = [];
  let changedCount = 0;
  let unchangedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  for (const key of [...allKeys].sort()) {
    const result = diffArtifact(key, snapshotA.artifacts[key], snapshotB.artifacts[key]);
    artifacts.push(result);

    switch (result.status) {
      case "unchanged":
        unchangedCount += 1;
        break;
      case "added":
        addedCount += 1;
        changedCount += 1;
        break;
      case "removed":
        removedCount += 1;
        changedCount += 1;
        break;
      case "modified":
        changedCount += 1;
        break;
    }
  }

  return {
    snapshotIdA: snapshotA.id,
    snapshotIdB: snapshotB.id,
    artifacts,
    changedCount,
    unchangedCount,
    addedCount,
    removedCount,
  };
}

function parseStructuredArtifact(
  artifact: SnapshotArtifact,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  const contentType = artifact.contentType ?? contentTypeFromPath(artifact.path);
  if ((contentType !== "json" && contentType !== "yaml") || artifact.content === undefined) {
    return { ok: false };
  }

  try {
    return {
      ok: true,
      value:
        contentType === "json"
          ? (JSON.parse(artifact.content) as unknown)
          : parseYaml(artifact.content),
    };
  } catch {
    return { ok: false };
  }
}

function contentTypeFromPath(filePath: string | undefined): "json" | "yaml" | undefined {
  if (filePath === undefined) {
    return undefined;
  }
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "yaml";
  }
  return undefined;
}
