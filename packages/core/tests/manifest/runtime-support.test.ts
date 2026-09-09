import { describe, expect, it } from "vitest";

import { assertManifestRuntimeSupported } from "../../src/manifest/runtime-support.js";
import type { AIStateManifest } from "../../src/manifest/types.js";

describe("assertManifestRuntimeSupported", () => {
  it("accepts the currently executable snapshot contract", () => {
    expect(() => assertManifestRuntimeSupported(manifest(), "snapshot")).not.toThrow();
  });

  it.each([
    ["git storage", { storage: { backend: "git", path: "./.aidrift/snapshots" } }],
    ["plugins", { plugins: ["example-plugin"] }],
  ] as const)("rejects unsupported common runtime feature: %s", (_name, override) => {
    expect(() =>
      assertManifestRuntimeSupported({ ...manifest(), ...override } as AIStateManifest, "snapshot"),
    ).toThrow(
      expect.objectContaining({
        code: "manifest.runtime.unsupported",
        exitCode: 2,
      }),
    );
  });

  it("accepts a non-default local storage path", () => {
    expect(() =>
      assertManifestRuntimeSupported(
        { ...manifest(), storage: { backend: "local", path: "./state/snapshots" } },
        "snapshot",
      ),
    ).not.toThrow();
  });

  it("accepts implemented sampling, significance, timeout, and provider target settings", () => {
    const value = manifest({
      eval: {
        suite: "./evals",
        format: "aidrift",
        samples_per_assertion: 5,
        significance_level: 0.05,
        timeout_seconds: 30,
        target: { type: "provider", model: "primary" },
      },
    });

    expect(() => assertManifestRuntimeSupported(value, "plan")).not.toThrow();
  });

  it("rejects an unimplemented HTTP eval target", () => {
    const value = manifest({
      eval: {
        suite: "./evals",
        target: { type: "http", url: "https://example.invalid" },
      },
    });

    expect(() => assertManifestRuntimeSupported(value, "plan")).toThrow(
      expect.objectContaining({
        code: "manifest.runtime.unsupported",
        why: expect.stringContaining("eval.target.type") as string,
      }),
    );
  });

  it("rejects artifact options that snapshot would ignore", () => {
    const value = manifest({
      artifacts: {
        models: {
          primary: { type: "model", provider: "mock", model: "mock-stable" },
        },
        custom: {
          policy: { type: "custom", path: "./policy.txt" },
        },
        adapters: {
          tuning: { type: "adapter", path: "./adapter.bin", hash_algorithm: "md5" },
        },
        rag: {
          index: {
            type: "rag_config",
            path: "./rag.yml",
            index_hash_command: "dangerous-command",
          },
        },
      },
    });

    expect(() => assertManifestRuntimeSupported(value, "snapshot")).toThrow(
      expect.objectContaining({
        why: expect.stringContaining("artifacts.custom") as string,
      }),
    );
  });

  it("rejects unsupported capture semantics for current-state diff only", () => {
    const value = manifest({
      artifacts: {
        models: {
          primary: { type: "model", provider: "mock", model: "mock-stable" },
        },
        custom: {
          policy: { type: "custom", path: "./policy.txt" },
        },
      },
    });

    expect(() =>
      assertManifestRuntimeSupported(value, "diff", { captureCurrentState: true }),
    ).toThrow(
      expect.objectContaining({
        why: expect.stringContaining("artifacts.custom") as string,
      }),
    );
    expect(() => assertManifestRuntimeSupported(value, "diff")).not.toThrow();
  });

  it("rejects plugin declarations before probe evidence is produced", () => {
    const value = manifest({ plugins: ["example-plugin"] });

    expect(() => assertManifestRuntimeSupported(value, "probe")).toThrow(
      expect.objectContaining({
        why: expect.stringContaining("plugin loading") as string,
      }),
    );
  });

  it("rejects RAG artifacts that a provider target cannot apply", () => {
    const value = manifest({
      artifacts: {
        models: {
          primary: { type: "model", provider: "mock", model: "mock-stable" },
        },
        rag: {
          index: { type: "rag_config", path: "./rag.yml" },
        },
      },
    });

    expect(() => assertManifestRuntimeSupported(value, "check")).toThrow(
      expect.objectContaining({
        why: expect.stringContaining("artifacts.rag") as string,
      }),
    );
  });
});

function manifest(override: Partial<AIStateManifest> = {}): AIStateManifest {
  return {
    version: "1",
    name: "runtime-contract",
    artifacts: {
      models: {
        primary: { type: "model", provider: "mock", model: "mock-stable" },
      },
    },
    eval: { suite: "./evals", target: { type: "provider", model: "primary" } },
    storage: { backend: "local", path: "./.aidrift/snapshots" },
    ...override,
  };
}
