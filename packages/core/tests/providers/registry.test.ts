import { describe, expect, it } from "vitest";

import { ProviderError } from "../../src/providers/errors.js";
import { resolveProbeProvider } from "../../src/providers/registry.js";

describe("resolveProbeProvider", () => {
  it("returns the deterministic mock provider for the mock id", () => {
    const provider = resolveProbeProvider({ providerId: "mock" });
    expect(provider.id).toBe("mock");
  });

  it("returns an openai-id provider for the openai id when env is set", () => {
    const provider = resolveProbeProvider({
      providerId: "openai",
      model: "gpt-4o-mini",
      env: { AIDRIFT_OPENAI_API_KEY: "sk-test" },
    });
    expect(provider.id).toBe("openai");
  });

  it("returns an anthropic-id provider for the anthropic id when env is set", () => {
    const provider = resolveProbeProvider({
      providerId: "anthropic",
      model: "claude-3-5-haiku-latest",
      env: { AIDRIFT_ANTHROPIC_API_KEY: "sk-ant-test" },
    });
    expect(provider.id).toBe("anthropic");
  });

  it("throws auth_missing when env key is unset for a live provider", () => {
    let captured: ProviderError | undefined;
    try {
      resolveProbeProvider({
        providerId: "openai",
        model: "gpt-4o-mini",
        env: {},
      });
    } catch (error) {
      captured = error as ProviderError;
    }
    expect(captured?.kind).toBe("auth_missing");
  });

  it("throws a clear ProviderError for an unknown provider id", () => {
    let captured: ProviderError | undefined;
    try {
      resolveProbeProvider({
        providerId: "made-up-vendor",
        model: "anything",
      });
    } catch (error) {
      captured = error as ProviderError;
    }
    expect(captured).toBeInstanceOf(ProviderError);
    expect(captured?.kind).toBe("unknown");
    expect(captured?.what).toContain("made-up-vendor");
  });

  it("throws when a live provider is requested without a model", () => {
    expect(() =>
      resolveProbeProvider({
        providerId: "openai",
        env: { AIDRIFT_OPENAI_API_KEY: "sk-test" },
      }),
    ).toThrow(ProviderError);
  });
});
