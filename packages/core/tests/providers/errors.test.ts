import { describe, expect, it } from "vitest";

import { AIDriftError, ExitCode } from "../../src/errors.js";
import { ProviderError } from "../../src/providers/errors.js";

describe("ProviderError", () => {
  it("preserves kind, providerId and exits with the non-regression config code", () => {
    const error = new ProviderError({
      kind: "rate_limit",
      providerId: "openai",
      message: "Rate limit exceeded.",
      fix: "Slow down requests or wait until the limit resets.",
      retryAfterMs: 5_000,
      httpStatus: 429,
    });

    expect(error).toBeInstanceOf(AIDriftError);
    expect(error.kind).toBe("rate_limit");
    expect(error.providerId).toBe("openai");
    expect(error.retryAfterMs).toBe(5_000);
    expect(error.httpStatus).toBe(429);
    expect(error.code).toBe("provider.rate_limit");
    expect(error.exitCode).toBe(ExitCode.ConfigError);
  });

  it("redacts secrets from the human-facing message", () => {
    const error = new ProviderError({
      kind: "auth_invalid",
      providerId: "openai",
      message: "Upstream rejected key sk-totallyrealsecretvalue with 401 status.",
      fix: "Verify AIDRIFT_OPENAI_API_KEY is set to a valid key.",
    });

    expect(error.what).not.toContain("sk-totallyrealsecretvalue");
    expect(error.what).toContain("<redacted>");
    expect(error.message).not.toContain("sk-totallyrealsecretvalue");
  });

  it("redacts secrets from the fix instructions", () => {
    const error = new ProviderError({
      kind: "auth_invalid",
      providerId: "openai",
      message: "Upstream rejected the key.",
      fix: "Replace the leaked key sk-leakedkey1234567890 in env.",
    });

    expect(error.fix).not.toContain("sk-leakedkey1234567890");
    expect(error.fix).toContain("<redacted>");
  });

  it("retains the underlying cause without exposing it through the message", () => {
    const cause = new Error("boom: sk-anothersecretvalue123");
    const error = new ProviderError({
      kind: "network_error",
      providerId: "anthropic",
      message: "Network failed while contacting provider.",
      fix: "Check network connectivity and retry.",
      cause,
    });

    expect(error.cause).toBe(cause);
    expect(error.what).not.toContain("sk-anothersecretvalue123");
  });
});
