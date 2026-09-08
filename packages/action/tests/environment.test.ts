import { describe, expect, it } from "vitest";

import { childProcessEnvironment } from "../src/environment.js";

describe("Action child environment", () => {
  it("passes operational values and only the provider credentials required by AIDRIFT", () => {
    expect(
      childProcessEnvironment({
        PATH: "/usr/bin",
        CI: "true",
        INPUT_GITHUB_TOKEN: "github_pat_secret",
        GITHUB_TOKEN: "github_pat_secret",
        GH_TOKEN: "ghp_secret",
        AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
        CUSTOM_PASSWORD: "secret",
        NODE_OPTIONS: "--import=/tmp/untrusted.mjs",
        AIDRIFT_OPENAI_API_KEY: "openai-secret",
        AIDRIFT_ANTHROPIC_API_KEY: "anthropic-secret",
        UNDEFINED: undefined,
      }),
    ).toEqual({
      PATH: "/usr/bin",
      CI: "true",
      AIDRIFT_OPENAI_API_KEY: "openai-secret",
      AIDRIFT_ANTHROPIC_API_KEY: "anthropic-secret",
    });
  });
});
