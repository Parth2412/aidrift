import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv } from "ajv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/runner.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(testDir, "fixtures", "check");
const schemaPath = path.resolve(testDir, "..", "..", "sdk", "schemas", "check-output.v3.json");
const junitXsdPath = path.join(fixturesDir, "junit.xsd");

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function fixturePath(scenario: string): string {
  return path.join(fixturesDir, scenario, ".aistate.yml");
}

function createTestIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
        },
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function normalizeContractOutput(value: string): string {
  return value
    .replace(/"startedAt": "[^"]+"/gu, '"startedAt": "<timestamp>"')
    .replace(/"completedAt": "[^"]+"/gu, '"completedAt": "<timestamp>"')
    .replace(/"durationMs": [0-9]+/gu, '"durationMs": <durationMs>')
    .replace(/timestamp="[^"]+"/gu, 'timestamp="<timestamp>"')
    .replace(/time="[0-9]+\.[0-9]{3}"/gu, 'time="<seconds>"')
    .replace(/\t[0-9]+\.[0-9]{2}\t/gu, "\t<score>\t");
}

function parseJsonObject(value: string): { readonly [key: string]: JsonValue } {
  const parsed = JSON.parse(value) as JsonValue;
  expect(isJsonObject(parsed)).toBe(true);
  return parsed as { readonly [key: string]: JsonValue };
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function expectCheckJsonSchemaValid(output: string): Promise<void> {
  const schema = parseJsonObject(await fs.readFile(schemaPath, "utf8"));
  const parsed = parseJsonObject(output);
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);

  expect(schema["$id"]).toBe("https://aidrift.dev/schemas/check-output.v3.json");
  expect(validate(parsed), ajv.errorsText(validate.errors)).toBe(true);
}

async function expectJunitXsdValid(output: string): Promise<void> {
  const xsd = await fs.readFile(junitXsdPath, "utf8");
  expect(xsd).toContain('<xs:element name="testsuites">');
  expect(output).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/u);
  expect(output).toMatch(/<testsuites\b[^>]*>/u);
  expect(output).toMatch(/<testsuite\b[^>]*tests="\d+"[^>]*failures="\d+"[^>]*errors="\d+"/u);
  expect(output).toMatch(
    /<testcase\b[^>]*name="[^"]+"[^>]*classname="aidrift\.check"[^>]*time="[^"]+"/u,
  );
}

const contractScenarios = [
  { name: "pass", exitCode: 0 },
  { name: "warn-only", exitCode: 0 },
  { name: "single-regression", exitCode: 1 },
  { name: "multiple-regressions", exitCode: 1 },
  { name: "missing-baseline", exitCode: 2 },
  { name: "malformed-manifest", exitCode: 2 },
] as const;

describe("aidrift check", () => {
  it("prints help for check", async () => {
    const test = createTestIo();
    const exitCode = await runCli(["node", "aidrift", "check", "--help"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("--format");
    expect(test.stdout).toContain("--baseline");
    expect(test.stdout).toContain("--output");
    expect(test.stdout).toContain("--fail-on");
    expect(test.stdout).toContain("--cost-budget");
    expect(test.stdout).toContain("--probe-category");
  });

  // --- pass scenario ---

  it("pass fixture exits 0 with passing summary", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("pass"), "check"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("PASS");
    expect(test.stdout).toContain("Probes: 20");
    expect(test.stdout).toContain("Result: PASS");
    expect(test.stderr).toBe("");
  });

  // --- warn-only scenario ---

  it("warn-only exits 0 with default --fail-on=fail", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("warn-only"), "check"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("WARN");
    expect(test.stdout).toContain("Result: PASS");
    expect(test.stderr).toBe("");
  });

  it("warn-only exits 1 with --fail-on=warn", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("warn-only"), "check", "--fail-on", "warn"],
      test.io,
    );

    expect(exitCode).toBe(1);
    expect(test.stdout).toContain("WARN");
    expect(test.stdout).toContain("Result: FAIL");
    expect(test.stderr).toBe("");
  });

  // --- single-regression scenario ---

  it("single-regression exits 1 with FAIL in output", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("single-regression"), "check"],
      test.io,
    );

    expect(exitCode).toBe(1);
    expect(test.stdout).toContain("FAIL");
    expect(test.stdout).toContain("1 regression");
    expect(test.stdout).toContain("Result: FAIL");
    expect(test.stderr).toBe("");
  });

  // --- multiple-regressions scenario ---

  it("multiple-regressions exits 1 with regression count", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("multiple-regressions"), "check"],
      test.io,
    );

    expect(exitCode).toBe(1);
    expect(test.stdout).toContain("2 regressions");
    expect(test.stdout).toContain("Result: FAIL");
    expect(test.stderr).toBe("");
  });

  // --- missing-baseline scenario ---

  it("missing-baseline exits 2 with baseline error", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("missing-baseline"), "check"],
      test.io,
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("Code: check.baseline.missing");
    expect(test.stderr).toContain("snapshot");
  });

  // --- malformed-manifest scenario ---

  it("malformed-manifest exits 2 with manifest error", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("malformed-manifest"), "check"],
      test.io,
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("Error:");
  });

  // --- missing manifest entirely ---

  it("missing manifest exits 2 with file-missing error", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", path.join(fixturesDir, "nonexistent.yml"), "check"],
      test.io,
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("manifest.file.missing");
  });

  // --- --format json ---

  it("--format json emits schema-valid output", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("pass"), "check", "--format", "json"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stderr).toBe("");

    const parsed = JSON.parse(test.stdout) as {
      readonly schemaVersion: string;
      readonly passed: boolean;
      readonly failOn: string;
      readonly summary: {
        readonly total: number;
        readonly passed: number;
        readonly warned: number;
        readonly failed: number;
        readonly new: number;
        readonly regressions: number;
      };
      readonly results: readonly {
        readonly assertionId: string;
        readonly status: string;
        readonly score: number;
        readonly critical: boolean;
        readonly tags: readonly string[];
      }[];
      readonly probes: {
        readonly summary: {
          readonly total: number;
          readonly passed: number;
          readonly drifted: number;
          readonly errors: number;
          readonly new: number;
        };
      };
      readonly startedAt: string;
      readonly completedAt: string;
      readonly durationMs: number;
      readonly artifacts: {
        readonly gate: string;
        readonly summary: { readonly changed: number };
      };
      readonly execution: {
        readonly samples: number;
        readonly estimatedRequests: number;
        readonly costEstimateKnown: boolean;
      };
    };

    expect(parsed.schemaVersion).toBe("3");
    expect(parsed.passed).toBe(true);
    expect(parsed.failOn).toBe("fail");
    expect(typeof parsed.durationMs).toBe("number");
    expect(parsed.artifacts).toMatchObject({
      gate: "informational",
      summary: { changed: 0 },
    });
    expect(parsed.execution).toMatchObject({
      samples: 5,
      estimatedRequests: 105,
      costEstimateKnown: true,
    });
    expect(parsed.summary).toMatchObject({
      total: 1,
      passed: 1,
      warned: 0,
      failed: 0,
      new: 0,
      regressions: 0,
    });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.probes.summary).toMatchObject({
      total: 20,
      passed: 0,
      drifted: 0,
      errors: 0,
      new: 20,
    });
    expect(parsed.results[0]).toMatchObject({
      assertionId: "always-passes",
      status: "PASS",
      score: 1,
      critical: true,
      tags: [],
    });
  });

  it("--format json regression includes passed=false and correct counts", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("single-regression"),
        "check",
        "--format",
        "json",
      ],
      test.io,
    );

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(test.stdout) as {
      readonly passed: boolean;
      readonly summary: { readonly failed: number; readonly regressions: number };
    };
    expect(parsed.passed).toBe(false);
    expect(parsed.summary.failed).toBe(1);
    expect(parsed.summary.regressions).toBe(1);
  });

  // --- --format junit ---

  it("--format junit emits valid JUnit XML structure", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("pass"), "check", "--format", "junit"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(test.stdout).toContain("<testsuites");
    expect(test.stdout).toContain("<testsuite");
    expect(test.stdout).toContain("<testcase");
    expect(test.stdout).toContain('name="always-passes"');
    expect(test.stdout).toContain('classname="aidrift.check"');
    expect(test.stdout).not.toContain("<failure");
  });

  it("--format junit includes failure element for regressions", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("single-regression"),
        "check",
        "--format",
        "junit",
      ],
      test.io,
    );

    expect(exitCode).toBe(1);
    expect(test.stdout).toContain("<failure");
    expect(test.stdout).toContain('type="regression"');
    expect(test.stdout).toContain('name="will-fail"');
  });

  it("--format junit respects --fail-on for warnings", async () => {
    const defaultThreshold = createTestIo();
    const defaultExitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("warn-only"), "check", "--format", "junit"],
      defaultThreshold.io,
    );
    expect(defaultExitCode).toBe(0);
    expect(defaultThreshold.stdout).toContain('failures="0"');
    expect(defaultThreshold.stdout).not.toContain('type="warning"');

    const warnThreshold = createTestIo();
    const warnExitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("warn-only"),
        "check",
        "--format",
        "junit",
        "--fail-on",
        "warn",
      ],
      warnThreshold.io,
    );
    expect(warnExitCode).toBe(1);
    expect(warnThreshold.stdout).toContain('failures="1"');
    expect(warnThreshold.stdout).toContain('type="warning"');
  });

  it("--format junit tests and failures attributes match counts", async () => {
    const test = createTestIo();
    await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("multiple-regressions"),
        "check",
        "--format",
        "junit",
      ],
      test.io,
    );

    expect(test.stdout).toContain('tests="22"');
    expect(test.stdout).toContain('failures="2"');
  });

  // --- --format github ---

  it("--format github emits ::error:: for FAIL assertions", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("single-regression"),
        "check",
        "--format",
        "github",
      ],
      test.io,
    );

    expect(exitCode).toBe(1);
    expect(test.stdout).toContain("::error");
    expect(test.stdout).toContain("will-fail");
    expect(test.stderr).toBe("");
  });

  it("--format github emits ::warning:: for WARN assertions", async () => {
    const test = createTestIo();
    await runCli(
      ["node", "aidrift", "--config", fixturePath("warn-only"), "check", "--format", "github"],
      test.io,
    );

    expect(test.stdout).toContain("::warning");
    expect(test.stdout).toContain("will-warn");
  });

  it("--format github emits no lines for fully passing run", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("pass"), "check", "--format", "github"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toBe("");
  });

  // --- --output flag ---

  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-check-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("--output writes file and stdout still receives output", async () => {
    const outFile = path.join(tmpDir, "result.json");
    const test = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("pass"),
        "check",
        "--format",
        "json",
        "--output",
        outFile,
      ],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain('"schemaVersion"');

    const fileContent = await fs.readFile(outFile, "utf8");
    const parsed = JSON.parse(fileContent) as { readonly schemaVersion: string };
    expect(parsed.schemaVersion).toBe("3");
    if (process.platform !== "win32") {
      expect((await fs.stat(outFile)).mode & 0o777).toBe(0o600);
    }
  });

  it("validates JSON output against check-output.v3 schema", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", fixturePath("pass"), "check", "--format", "json"],
      test.io,
    );

    expect(exitCode).toBe(0);
    await expectCheckJsonSchemaValid(test.stdout);
  });

  it("validates JUnit XML against the fixture XSD contract", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("single-regression"),
        "check",
        "--format",
        "junit",
      ],
      test.io,
    );

    expect(exitCode).toBe(1);
    await expectJunitXsdValid(test.stdout);
  });

  it("github annotations include file and line keys", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("single-regression"),
        "check",
        "--format",
        "github",
      ],
      test.io,
    );

    expect(exitCode).toBe(1);
    expect(test.stdout).toMatch(/^::error file=[^,]+,line=1::/u);
  });

  it("aborts live manifest providers without prompting when env is missing", async () => {
    const projectDir = path.join(tmpDir, "live-provider-missing-env");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });
    const manifestPath = path.join(projectDir, ".aistate.yml");
    const manifest = await fs.readFile(manifestPath, "utf8");
    await fs.writeFile(manifestPath, manifest.replace("provider: mock", "provider: openai"));

    const test = createTestIo();
    const exitCode = await runCli(["node", "aidrift", "--config", manifestPath, "check"], {
      ...test.io,
      env: { AIDRIFT_OPENAI_API_KEY: "" },
    });

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("AIDRIFT_OPENAI_API_KEY");
    expect(test.stdout).toBe("");
  });

  it("rejects unsupported manifest providers instead of silently using mock", async () => {
    const projectDir = path.join(tmpDir, "unsupported-provider");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });
    const manifestPath = path.join(projectDir, ".aistate.yml");
    const manifest = await fs.readFile(manifestPath, "utf8");
    await fs.writeFile(manifestPath, manifest.replace("provider: mock", "provider: custom"));

    const test = createTestIo();
    const exitCode = await runCli(["node", "aidrift", "--config", manifestPath, "check"], test.io);

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("eval.provider.unsupported");
    expect(test.stderr).toContain("supports mock, openai, and anthropic only");
    expect(test.stdout).toBe("");
  });

  it("routes multiple model artifacts independently while the eval target stays explicit", async () => {
    const projectDir = path.join(tmpDir, "ambiguous-models");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });
    const manifestPath = path.join(projectDir, ".aistate.yml");
    const manifest = await fs.readFile(manifestPath, "utf8");
    await fs.writeFile(
      manifestPath,
      manifest.replace(
        "eval:",
        [
          "    secondary:",
          "      type: model",
          "      provider: mock",
          "      model: mock-secondary",
          "eval:",
        ].join("\n"),
      ),
    );

    const test = createTestIo();
    const exitCode = await runCli(["node", "aidrift", "--config", manifestPath, "check"], test.io);

    expect(exitCode).toBe(0);
    expect(test.stderr).toBe("");
    expect(test.stdout).toContain("Probes: 40");
    expect(test.stdout).toContain("primary/deterministic_math");
    expect(test.stdout).toContain("secondary/deterministic_math");
  });

  it("aborts manifests that mix live provider families", async () => {
    const projectDir = path.join(tmpDir, "mixed-live-providers");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });
    const manifestPath = path.join(projectDir, ".aistate.yml");
    await fs.writeFile(
      manifestPath,
      [
        'version: "1"',
        "name: mixed-live-providers",
        "artifacts:",
        "  models:",
        "    primary:",
        "      type: model",
        "      provider: openai",
        "      model: gpt-4o-2024-08-06",
        "    secondary:",
        "      type: model",
        "      provider: anthropic",
        "      model: claude-3-5-sonnet-20241022",
        "eval:",
        "  suite: ./evals",
        "  target:",
        "    type: provider",
        "    model: primary",
        "storage:",
        "  backend: local",
        "  path: ./.aidrift/snapshots",
        "",
      ].join("\n"),
      "utf8",
    );

    const test = createTestIo();
    const exitCode = await runCli(["node", "aidrift", "--config", manifestPath, "check"], {
      ...test.io,
      env: {},
    });

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("AIDRIFT_OPENAI_API_KEY");
  });

  it("resolves --baseline from snapshot label, tag, and git SHA prefix", async () => {
    const projectDir = path.join(tmpDir, "baseline-aliases");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });

    const snapshotPath = path.join(
      projectDir,
      ".aidrift",
      "snapshots",
      "snap_20260101_000000.json",
    );
    const snapshot = parseJsonObject(await fs.readFile(snapshotPath, "utf8"));
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(
        {
          ...snapshot,
          label: "release-candidate",
          tags: ["ci-baseline"],
          metadata: {
            cliVersion: "0.0.0",
            nodeVersion: "v22.0.0",
            os: "linux",
            gitCommit: "abcdef1234567890",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    for (const baseline of ["release-candidate", "ci-baseline", "abcdef1"]) {
      const test = createTestIo();
      const exitCode = await runCli(
        [
          "node",
          "aidrift",
          "--config",
          path.join(projectDir, ".aistate.yml"),
          "check",
          "--baseline",
          baseline,
        ],
        test.io,
      );
      expect(exitCode).toBe(0);
      expect(test.stdout).toContain("Baseline: snap_20260101_000000");
    }
  });

  it("returns exit 2 when --baseline does not match any snapshot alias", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("pass"),
        "check",
        "--baseline",
        "missing-sha-or-tag",
      ],
      test.io,
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("check.baseline.not_found");
  });

  it("escapes github annotation command data in every format", async () => {
    const projectDir = path.join(tmpDir, "escaping-redaction");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });
    const evalPath = path.join(projectDir, "evals", "basic.assertions.yml");
    await fs.writeFile(
      evalPath,
      [
        "suite: escaping-redaction",
        "assertions:",
        "  - id: always-passes",
        "    type: contains",
        '    input: "return the word mock"',
        "    expected_contains:",
        "      - |",
        "        MISSING%VALUE",
        "    critical: true",
        "",
      ].join("\n"),
      "utf8",
    );

    for (const format of ["text", "json", "junit", "github"] as const) {
      const test = createTestIo();
      const exitCode = await runCli(
        [
          "node",
          "aidrift",
          "--config",
          path.join(projectDir, ".aistate.yml"),
          "check",
          "--format",
          format,
        ],
        test.io,
      );

      expect(exitCode).toBe(1);
      if (format === "github") {
        expect(test.stdout).toContain("MISSING%25VALUE%0A");
      }
    }
  });

  it("reports provider probe drift in github and junit formats", async () => {
    const projectDir = path.join(tmpDir, "probe-regression");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });

    const snapshotPath = path.join(
      projectDir,
      ".aidrift",
      "snapshots",
      "snap_20260101_000000.json",
    );
    const snapshot = parseJsonObject(await fs.readFile(snapshotPath, "utf8"));
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(
        {
          ...snapshot,
          probe: {
            baselines: {
              "primary/deterministic_math": {
                output: "different baseline output",
                score: 1,
                provider: "mock",
                model: "gpt-4o-2024-08-06",
                modelName: "primary",
                probeId: "deterministic_math",
                samples: Array.from({ length: 5 }, () => ({
                  output: "different baseline output",
                  latencyMs: 10,
                  costUsd: 0,
                })),
                capturedAt: "2026-01-01T00:00:00.000Z",
                snapshotId: "snap_20260101_000000",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const text = createTestIo();
    const textExitCode = await runCli(
      ["node", "aidrift", "--config", path.join(projectDir, ".aistate.yml"), "check"],
      text.io,
    );
    expect(textExitCode).toBe(1);
    expect(text.stdout).toContain("primary/deterministic_math\tDRIFT\t1.00 -> 0.00");

    const github = createTestIo();
    const githubExitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        path.join(projectDir, ".aistate.yml"),
        "check",
        "--format",
        "github",
      ],
      github.io,
    );
    expect(githubExitCode).toBe(1);
    expect(github.stdout).toContain("primary/deterministic_math");
    expect(github.stdout).toContain("::error file=");

    const junit = createTestIo();
    const junitExitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        path.join(projectDir, ".aistate.yml"),
        "check",
        "--format",
        "junit",
      ],
      junit.io,
    );
    expect(junitExitCode).toBe(1);
    expect(junit.stdout).toContain('type="drift"');
    expect(junit.stdout).toContain("primary/deterministic_math");
  });

  it("reports assertions with no eval baseline as new", async () => {
    const projectDir = path.join(tmpDir, "new-assertion");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });

    const snapshotPath = path.join(
      projectDir,
      ".aidrift",
      "snapshots",
      "snap_20260101_000000.json",
    );
    const snapshot = parseJsonObject(await fs.readFile(snapshotPath, "utf8"));
    await fs.writeFile(
      snapshotPath,
      JSON.stringify({ ...snapshot, eval: { baselines: {} } }, null, 2),
      "utf8",
    );

    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", path.join(projectDir, ".aistate.yml"), "check"],
      test.io,
    );

    expect(exitCode).toBe(0);
    expect(test.stdout).toContain("always-passes\tNEW\tnew");
  });

  it("reports current artifact-state drift without treating it as a behavioral failure", async () => {
    const projectDir = path.join(tmpDir, "artifact-drift");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });
    const snapshotPath = path.join(
      projectDir,
      ".aidrift",
      "snapshots",
      "snap_20260101_000000.json",
    );
    const snapshot = await fs.readFile(snapshotPath, "utf8");
    await fs.writeFile(
      snapshotPath,
      snapshot.replace(
        "sha256:3aaf5bd3e28e21da157e52b3d9c73173a8f444dfe281fad4d5d7f5ed80864a8b",
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      ),
      "utf8",
    );

    const json = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        path.join(projectDir, ".aistate.yml"),
        "check",
        "--format",
        "json",
      ],
      json.io,
    );
    const output = JSON.parse(json.stdout) as {
      readonly passed: boolean;
      readonly artifacts: {
        readonly gate: string;
        readonly summary: { readonly changed: number };
      };
    };

    expect(exitCode).toBe(0);
    expect(output.passed).toBe(true);
    expect(output.artifacts).toMatchObject({
      gate: "informational",
      summary: { changed: 1 },
    });

    const github = createTestIo();
    await runCli(
      [
        "node",
        "aidrift",
        "--config",
        path.join(projectDir, ".aistate.yml"),
        "check",
        "--format",
        "github",
      ],
      github.io,
    );
    expect(github.stdout).toContain("::notice");
    expect(github.stdout).toContain("artifact/models/primary");
  });

  it("applies explicit sample, probe, concurrency, and timeout controls", async () => {
    const test = createTestIo();
    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "--config",
        fixturePath("pass"),
        "check",
        "--format",
        "json",
        "--samples",
        "2",
        "--probe-model",
        "primary",
        "--probe-category",
        "deterministic",
        "--concurrency",
        "1",
        "--timeout",
        "10",
      ],
      test.io,
    );
    const output = JSON.parse(test.stdout) as {
      readonly execution: {
        readonly samples: number;
        readonly concurrency: number;
        readonly timeoutSeconds: number;
        readonly estimatedRequests: number;
      };
      readonly probes: { readonly summary: { readonly total: number } };
    };

    expect(exitCode).toBe(0);
    expect(output.execution).toMatchObject({
      samples: 2,
      concurrency: 1,
      timeoutSeconds: 10,
      estimatedRequests: 10,
    });
    expect(output.probes.summary.total).toBe(4);
  });

  it("rejects malformed bounded-run controls before execution", async () => {
    for (const args of [
      ["--samples", "1.5"],
      ["--samples", "101"],
      ["--concurrency", "0"],
      ["--concurrency", "33"],
      ["--timeout", "NaN"],
      ["--timeout", "3601"],
      ["--probe-category", "unknown"],
      ["--probe-model", "missing"],
    ]) {
      const test = createTestIo();
      const exitCode = await runCli(
        ["node", "aidrift", "--config", fixturePath("pass"), "check", ...args],
        test.io,
      );
      expect(exitCode).toBe(2);
      expect(test.stderr).toContain("check.option.invalid");
      expect(test.stdout).toBe("");
    }
  });

  it("requires an enforceable cost budget before any live CI request", async () => {
    const projectDir = path.join(tmpDir, "live-cost-bound");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });
    const manifestPath = path.join(projectDir, ".aistate.yml");
    const manifest = await fs.readFile(manifestPath, "utf8");
    await fs.writeFile(manifestPath, manifest.replace("provider: mock", "provider: openai"));

    const missingBudget = createTestIo();
    const missingBudgetExit = await runCli(["node", "aidrift", "--config", manifestPath, "check"], {
      ...missingBudget.io,
      env: { AIDRIFT_OPENAI_API_KEY: "test-key-not-sent" },
    });
    expect(missingBudgetExit).toBe(2);
    expect(missingBudget.stderr).toContain("check.cost_budget.required");

    const exceededBudget = createTestIo();
    const exceededBudgetExit = await runCli(
      ["node", "aidrift", "--config", manifestPath, "check", "--cost-budget", "0"],
      {
        ...exceededBudget.io,
        env: { AIDRIFT_OPENAI_API_KEY: "test-key-not-sent" },
      },
    );
    expect(exceededBudgetExit).toBe(2);
    expect(exceededBudget.stderr).toContain("check.budget.exceeded");
  });

  it("rejects unpriced live models even when a CI budget is supplied", async () => {
    const projectDir = path.join(tmpDir, "unpriced-live-model");
    await fs.cp(path.dirname(fixturePath("pass")), projectDir, { recursive: true });
    const manifestPath = path.join(projectDir, ".aistate.yml");
    const manifest = await fs.readFile(manifestPath, "utf8");
    await fs.writeFile(
      manifestPath,
      manifest
        .replace("provider: mock", "provider: openai")
        .replace("gpt-4o-2024-08-06", "gpt-unknown-future"),
    );

    const test = createTestIo();
    const exitCode = await runCli(
      ["node", "aidrift", "--config", manifestPath, "check", "--cost-budget", "10"],
      {
        ...test.io,
        env: { AIDRIFT_OPENAI_API_KEY: "test-key-not-sent" },
      },
    );

    expect(exitCode).toBe(2);
    expect(test.stderr).toContain("check.cost.unknown");
  });

  for (const scenario of contractScenarios) {
    it(`snapshots text contract for ${scenario.name}`, async () => {
      const test = createTestIo();
      const exitCode = await runCli(
        ["node", "aidrift", "--config", fixturePath(scenario.name), "check"],
        test.io,
      );

      expect(exitCode).toBe(scenario.exitCode);
      expect({
        exitCode,
        stdout: normalizeContractOutput(test.stdout),
        stderr: normalizeContractOutput(test.stderr),
      }).toMatchSnapshot();
    });

    for (const format of ["json", "junit", "github"] as const) {
      it(`snapshots ${format} output-file contract for ${scenario.name}`, async () => {
        const outFile = path.join(tmpDir, `${scenario.name}.${format}`);
        const test = createTestIo();
        const exitCode = await runCli(
          [
            "node",
            "aidrift",
            "--config",
            fixturePath(scenario.name),
            "check",
            "--format",
            format,
            "--output",
            outFile,
          ],
          test.io,
        );
        const fileContent =
          exitCode === 2 ? "" : await fs.readFile(outFile, "utf8").catch(() => "");

        expect(exitCode).toBe(scenario.exitCode);
        expect({
          exitCode,
          stdout: normalizeContractOutput(test.stdout),
          stderr: normalizeContractOutput(test.stderr),
          outputFile: normalizeContractOutput(fileContent),
        }).toMatchSnapshot();

        if (format === "json" && exitCode !== 2) {
          await expectCheckJsonSchemaValid(fileContent);
        }
        if (format === "junit" && exitCode !== 2) {
          await expectJunitXsdValid(fileContent);
        }
      });
    }
  }
});
