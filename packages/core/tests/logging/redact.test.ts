import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/logging/logger.js";
import { redactSecrets } from "../../src/logging/redact.js";

describe("redactSecrets", () => {
  it("redacts provider keys, GitHub tokens, bearer tokens, and secret env assignments", () => {
    const input =
      "OPENAI_API_KEY=sk-testsecret123 github_pat_abcdefghi Bearer abc.def.ghi npm-secret123";

    const output = redactSecrets(input);

    expect(output).toContain("OPENAI_API_KEY=<redacted>");
    expect(output).toContain("Bearer <redacted>");
    expect(output).not.toContain("sk-testsecret123");
    expect(output).not.toContain("github_pat_abcdefghi");
    expect(output).not.toContain("npm-secret123");
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
