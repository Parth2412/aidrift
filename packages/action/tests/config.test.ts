import { describe, expect, it } from "vitest";

import { buildCheckArguments, readActionInputs } from "../src/config.js";
import { createCore } from "./helpers.js";

describe("Action input contract", () => {
  it("uses secure defaults and forwards bounded check controls", () => {
    const test = createCore({
      manifest: "state.yml",
      "fail-on": "warn",
      samples: "7",
      "probe-category": "behavioral",
      concurrency: "2",
      timeout: "90",
      "cost-budget": "0.25",
      "comment-mode": "none",
      "github-token": "github_pat_secretvalue",
    });
    const inputs = readActionInputs(test.core);

    expect(inputs).toMatchObject({
      manifest: "state.yml",
      failOn: "warn",
      samples: "7",
      probeCategory: "behavioral",
      concurrency: "2",
      timeout: "90",
      costBudget: "0.25",
      commentMode: "none",
      uploadArtifact: true,
      retentionDays: 7,
    });
    expect(test.secrets).toEqual(["github_pat_secretvalue"]);
    expect(buildCheckArguments(inputs)).toEqual([
      "--config",
      "state.yml",
      "check",
      "--format",
      "json",
      "--fail-on",
      "warn",
      "--samples",
      "7",
      "--probe-category",
      "behavioral",
      "--concurrency",
      "2",
      "--timeout",
      "90",
      "--cost-budget",
      "0.25",
    ]);
  });

  it.each([
    ["fail-on", "sometimes"],
    ["comment-mode", "duplicate"],
    ["probe-category", "unknown"],
    ["samples", "1.5"],
    ["samples", "101"],
    ["concurrency", "0"],
    ["concurrency", "33"],
    ["timeout", "NaN"],
    ["timeout", "3601"],
    ["cost-budget", "-1"],
    ["upload-artifact", "perhaps"],
    ["retention-days", "91"],
    ["artifact-name", "unsafe/name"],
  ])("rejects invalid %s input", (name, value) => {
    const test = createCore({ [name]: value });
    expect(() => readActionInputs(test.core)).toThrow();
  });
});
