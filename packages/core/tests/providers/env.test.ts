import { describe, expect, it } from "vitest";

import { ProviderError } from "../../src/providers/errors.js";
import { loadProviderApiKey } from "../../src/providers/env.js";

describe("loadProviderApiKey", () => {
  it("returns the value when the env variable is set", () => {
    const key = loadProviderApiKey({
      envVar: "AIDRIFT_FAKE_API_KEY",
      providerId: "fake",
      env: { AIDRIFT_FAKE_API_KEY: "sk-test-value" },
    });

    expect(key).toBe("sk-test-value");
  });

  it("throws ProviderError(auth_missing) when the env variable is unset", () => {
    expect(() =>
      loadProviderApiKey({
        envVar: "AIDRIFT_FAKE_API_KEY",
        providerId: "fake",
        env: {},
      }),
    ).toThrow(ProviderError);
  });

  it("throws auth_missing whose message names the env var but never the value", () => {
    let captured: ProviderError | undefined;
    try {
      loadProviderApiKey({
        envVar: "AIDRIFT_FAKE_API_KEY",
        providerId: "fake",
        env: {},
      });
    } catch (error) {
      captured = error as ProviderError;
    }

    expect(captured).toBeInstanceOf(ProviderError);
    expect(captured?.kind).toBe("auth_missing");
    expect(captured?.providerId).toBe("fake");
    expect(captured?.what).toContain("AIDRIFT_FAKE_API_KEY");
    expect(captured?.fix).toContain("AIDRIFT_FAKE_API_KEY");
  });

  it("treats whitespace-only values as missing", () => {
    expect(() =>
      loadProviderApiKey({
        envVar: "AIDRIFT_FAKE_API_KEY",
        providerId: "fake",
        env: { AIDRIFT_FAKE_API_KEY: "   " },
      }),
    ).toThrow(ProviderError);
  });

  it("never echoes the value back through the thrown error even if env contained a sentinel", () => {
    let captured: ProviderError | undefined;
    try {
      loadProviderApiKey({
        envVar: "AIDRIFT_FAKE_API_KEY",
        providerId: "fake",
        env: { AIDRIFT_FAKE_API_KEY: "" },
      });
    } catch (error) {
      captured = error as ProviderError;
    }

    expect(captured?.what).not.toMatch(/sk-/);
  });
});
