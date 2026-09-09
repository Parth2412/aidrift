import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/logging/logger.js";
import { redactSecrets } from "../../src/logging/redact.js";

describe("redactSecrets", () => {
  it("redacts provider keys, GitHub tokens, bearer tokens, and secret env assignments", () => {
    const input =
      'OPENAI_API_KEY=sk-testsecret123 github_pat_abcdefghi Bearer abc.def.ghi npm-secret123 {"error":"missing:\\nsk-test-escaped123"}';

    const output = redactSecrets(input);

    expect(output).toContain("OPENAI_API_KEY=<redacted>");
    expect(output).toContain("Bearer <redacted>");
    expect(output).not.toContain("sk-testsecret123");
    expect(output).not.toContain("sk-test-escaped123");
    expect(output).not.toContain("github_pat_abcdefghi");
    expect(output).not.toContain("npm-secret123");
  });

  it.each([
    ["modern npm", "npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"],
    ["PyPI", "pypi-AgEIcHlwaS5vcmcCJDEyMzQ1Njc4OTBhYmNkZWY"],
    ["GitLab", "glpat-abcdefghijklmnopqrst"],
    ["Hugging Face", "hf_abcdefghijklmnopqrstuvwxyz123456"],
    ["Slack", ["xoxb", "1234567890", "abcdefghijklmnop"].join("-")],
    ["AWS", "AKIAIOSFODNN7EXAMPLE"],
    ["Google", "AIzaSyA1234567890abcdefghijklmnopqrst"],
  ])("redacts %s token formats", (_label, secret) => {
    const output = redactSecrets(`before ${secret} after`);

    expect(output).toBe("before <redacted> after");
    expect(output).not.toContain(secret);
  });

  it("redacts JSON values, URL passwords, and private keys without broad key-word matches", () => {
    const privateKey =
      "-----BEGIN PRIVATE KEY-----\nnot-a-real-private-key\n-----END PRIVATE KEY-----";
    const output = redactSecrets(
      `{"api_key":"sensitive-value","monkey":"banana"} https://user:password@example.test ${privateKey}`,
    );

    expect(output).toContain('"api_key":"<redacted>');
    expect(output).toContain('"monkey":"banana"');
    expect(output).toContain("https://user:<redacted>@example.test");
    expect(output).not.toContain("sensitive-value");
    expect(output).not.toContain("not-a-real-private-key");
  });
});

describe("createLogger", () => {
  it("writes redacted messages to stderr-like streams", () => {
    let stderr = "";
    const logger = createLogger({
      level: "debug",
      stderr: {
        write: (chunk) => {
          stderr += chunk;
        },
      },
    });

    logger.debug("using key sk-testsecret123");

    expect(stderr).toContain("[debug]");
    expect(stderr).toContain("<redacted>");
    expect(stderr).not.toContain("sk-testsecret123");
  });
});
