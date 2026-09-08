import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAction } from "../src/index.js";
import type { ActionDependencies, CheckEvidence } from "../src/types.js";
import { createCore, passingEvidence, pushContext } from "./helpers.js";

describe("Action runner", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-action-test-"));
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it.each([
    { cliExit: 0, expectedExit: 0, expectedResult: "pass" },
    { cliExit: 1, expectedExit: 1, expectedResult: "fail" },
  ] as const)("propagates CLI exit $cliExit with one execution", async (scenario) => {
    const evidence = scenario.cliExit === 0 ? passingEvidence() : failingEvidence();
    const test = createCore({ "comment-mode": "none", "upload-artifact": "false" });
    const run = vi.fn(async () => ({
      exitCode: scenario.cliExit,
      stdout: JSON.stringify(evidence),
      stderr: "",
    }));
    const exitCode = await runAction(dependencies(test.core, run, temporaryDirectory));

    expect(exitCode).toBe(scenario.expectedExit);
    expect(test.outputs.get("result")).toBe(scenario.expectedResult);
    expect(test.outputs.get("regressions")).toBe(scenario.cliExit === 0 ? 0 : 1);
    expect(run).toHaveBeenCalledOnce();
  });

  it("uploads redacted error evidence and preserves exit 2", async () => {
    const test = createCore({
      "comment-mode": "none",
      "upload-artifact": "true",
      "artifact-name": "bounded-results",
    });
    let uploadedJson = "";
    let uploadedJunit = "";
    const deps = dependencies(
      test.core,
      async () => ({
        exitCode: 2,
        stdout: "",
        stderr:
          "Provider rejected sk-test-secretvalue1234567890 Bearer abcdefghijklmnopqrstuvwxyz AWS_SECRET_ACCESS_KEY=top-secret-value",
      }),
      temporaryDirectory,
    );
    const actionDependencies: ActionDependencies = {
      ...deps,
      artifact: {
        async upload(name, files) {
          expect(name).toBe("bounded-results");
          uploadedJson = await fs.readFile(files[0]!, "utf8");
          uploadedJunit = await fs.readFile(files[1]!, "utf8");
          return { id: 42 };
        },
      },
    };

    const exitCode = await runAction(actionDependencies);
    expect(exitCode).toBe(2);
    expect(uploadedJson).toContain('"schemaVersion": "action-error.v1"');
    expect(uploadedJson).not.toContain("sk-test-secretvalue");
    expect(uploadedJson).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(uploadedJson).not.toContain("top-secret-value");
    expect(uploadedJunit).toContain("<error");
    expect(test.outputs.get("artifact-id")).toBe(42);
    expect(test.outputs.get("artifact-url")).toContain("/artifacts/42");
  });

  it("publishes fallback error evidence when successful CLI output violates the contract", async () => {
    const test = createCore({ "comment-mode": "none", "upload-artifact": "true" });
    let uploadedJson = "";
    const deps = dependencies(
      test.core,
      async () => ({ exitCode: 0, stdout: '{"schemaVersion":"3"}', stderr: "" }),
      temporaryDirectory,
    );

    const exitCode = await runAction({
      ...deps,
      artifact: {
        async upload(_name, files) {
          uploadedJson = await fs.readFile(files[0]!, "utf8");
          return {};
        },
      },
    });

    expect(exitCode).toBe(2);
    expect(uploadedJson).toContain('"schemaVersion": "action-error.v1"');
    expect(uploadedJson).toContain("unsupported or incomplete evidence contract");
    expect(test.outputs.get("result")).toBe("error");
  });

  it("sets error outputs when temporary evidence storage cannot be created", async () => {
    const invalidTemporaryDirectory = path.join(temporaryDirectory, "not-a-directory");
    await fs.writeFile(invalidTemporaryDirectory, "occupied", "utf8");
    const test = createCore();
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));

    const exitCode = await runAction(dependencies(test.core, run, invalidTemporaryDirectory));

    expect(exitCode).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(test.outputs.get("result")).toBe("error");
  });

  it("fails closed before CLI execution on pull_request_target", async () => {
    const test = createCore();
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deps = dependencies(test.core, run, temporaryDirectory);
    const exitCode = await runAction({
      ...deps,
      context: { ...pushContext(), eventName: "pull_request_target" },
    });

    expect(exitCode).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(test.errors.join(" ")).toContain("refuses pull_request_target");
  });
});

function dependencies(
  core: ActionDependencies["core"],
  run: ActionDependencies["exec"]["run"],
  temporaryDirectory: string,
): ActionDependencies {
  return {
    core,
    exec: { run },
    artifact: { upload: async () => ({}) },
    context: pushContext(),
    createCommentAdapter: () => ({
      list: async () => [],
      create: async () => undefined,
      update: async () => undefined,
    }),
    cliPath: "/bundled/aidrift.js",
    temporaryDirectory,
  };
}

function failingEvidence(): CheckEvidence {
  return passingEvidence({
    passed: false,
    summary: { total: 1, passed: 0, warned: 0, failed: 1, new: 0, regressions: 1 },
    results: [
      {
        ...passingEvidence().results[0]!,
        assertionId: "regression",
        status: "FAIL",
        score: 0,
        baselineScore: 1,
        latencyMs: 10,
        explanation: "Regression.",
      },
    ],
  });
}
