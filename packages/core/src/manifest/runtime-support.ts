import { AIDriftError, ExitCode } from "../errors.js";
import type { AIStateManifest, ArtifactGroups } from "./types.js";

export type ManifestRuntimeCommand = "snapshot" | "history" | "diff" | "plan" | "probe" | "check";

export interface ManifestRuntimeSupportOptions {
  readonly captureCurrentState?: boolean | undefined;
}

interface UnsupportedFeature {
  readonly manifestPath: string;
  readonly reason: string;
}

export function assertManifestRuntimeSupported(
  manifest: AIStateManifest,
  command: ManifestRuntimeCommand,
  options: ManifestRuntimeSupportOptions = {},
): void {
  const unsupported = collectUnsupportedFeatures(manifest, command, options);
  const first = unsupported[0];
  if (first === undefined) {
    return;
  }

  throw new AIDriftError({
    code: "manifest.runtime.unsupported",
    exitCode: ExitCode.ConfigError,
    what: `The manifest requests behavior that aidrift ${command} cannot execute yet.`,
    why: unsupported.map((feature) => `${feature.manifestPath}: ${feature.reason}`).join("; "),
    fix: `Remove the unsupported setting or use a manifest containing only features supported by aidrift ${command}.`,
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}

function collectUnsupportedFeatures(
  manifest: AIStateManifest,
  command: ManifestRuntimeCommand,
  options: ManifestRuntimeSupportOptions,
): readonly UnsupportedFeature[] {
  const unsupported: UnsupportedFeature[] = [];
  const capturesCurrentState = command === "snapshot" || options.captureCurrentState === true;

  if (manifest.storage.backend !== "local") {
    unsupported.push({
      manifestPath: "storage.backend",
      reason: `backend ${manifest.storage.backend} is declared but only local storage is implemented`,
    });
  }

  if (
    manifest.plugins !== undefined &&
    manifest.plugins.length > 0 &&
    (capturesCurrentState || command === "plan" || command === "probe" || command === "check")
  ) {
    unsupported.push({
      manifestPath: "plugins",
      reason: "plugin loading is not implemented",
    });
  }

  if (capturesCurrentState || command === "plan" || command === "check") {
    collectUnsupportedArtifactFeatures(manifest.artifacts, unsupported);
  }

  if (command === "plan" || command === "check") {
    if (manifest.eval.format === "promptfoo") {
      unsupported.push({
        manifestPath: "eval.format",
        reason: "the Promptfoo suite format is not implemented",
      });
    }
    if (manifest.eval.target === undefined) {
      unsupported.push({
        manifestPath: "eval.target",
        reason: "an explicit provider target is required for behavioral execution",
      });
    } else if (manifest.eval.target.type !== "provider") {
      unsupported.push({
        manifestPath: "eval.target.type",
        reason: `target type ${manifest.eval.target.type} is declared but only provider execution is implemented`,
      });
    }

    for (const group of ["rag", "tools", "safety", "adapters"] as const) {
      if (Object.keys(manifest.artifacts[group] ?? {}).length > 0) {
        unsupported.push({
          manifestPath: `artifacts.${group}`,
          reason:
            "the provider eval target does not apply this artifact group to provider requests",
        });
      }
    }

    for (const [name, prompt] of Object.entries(manifest.artifacts.prompts ?? {})) {
      if (prompt.format !== undefined && prompt.format !== "text") {
        unsupported.push({
          manifestPath: `artifacts.prompts.${name}.format`,
          reason: `prompt format ${prompt.format} cannot be rendered by the provider eval target`,
        });
      }
    }
  }

  return unsupported;
}

function collectUnsupportedArtifactFeatures(
  artifacts: ArtifactGroups,
  unsupported: UnsupportedFeature[],
): void {
  if (Object.keys(artifacts.custom ?? {}).length > 0) {
    unsupported.push({
      manifestPath: "artifacts.custom",
      reason: "custom artifact resolution and snapshot capture are not implemented",
    });
  }

  for (const [name, artifact] of Object.entries(artifacts.adapters ?? {})) {
    if (artifact.hash_algorithm === "md5") {
      unsupported.push({
        manifestPath: `artifacts.adapters.${name}.hash_algorithm`,
        reason: "MD5 capture is not implemented and AIDRIFT snapshots require SHA-256",
      });
    }
  }

  for (const [name, artifact] of Object.entries(artifacts.rag ?? {})) {
    if (artifact.index_hash_command !== undefined) {
      unsupported.push({
        manifestPath: `artifacts.rag.${name}.index_hash_command`,
        reason: "executing index hash commands is not implemented",
      });
    }
  }
}
