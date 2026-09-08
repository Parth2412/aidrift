import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(testDirectory, "..", "..", "dist", "cli.js");

test("built CLI proves baseline, pass, regression, and config-error exits", async () => {
  const projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-built-check-"));
  const manifestPath = path.join(projectDirectory, ".aistate.yml");
  const suitePath = path.join(projectDirectory, "evals", "behavior.assertions.yml");

  try {
    await fs.mkdir(path.dirname(suitePath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `version: "1"
name: built-check-e2e
artifacts:
  models:
    primary:
      type: model
      provider: mock
      model: mock-v1
eval:
  suite: ./evals
  samples_per_assertion: 5
  timeout_seconds: 30
  target:
    type: provider
    model: primary
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
      "utf8",
    );
    await writeSuite(suitePath, "mock");

    const baseline = invoke(projectDirectory, manifestPath, [
      "snapshot",
      "--with-evals",
      "--with-probes",
      "--provider",
      "mock",
      "--samples",
      "5",
    ]);
    assert.equal(baseline.status, 0, baseline.stderr);

    const unchanged = invoke(projectDirectory, manifestPath, ["check", "--format", "json"]);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    const unchangedEvidence = JSON.parse(unchanged.stdout);
    assert.equal(unchangedEvidence.schemaVersion, "3");
    assert.equal(unchangedEvidence.passed, true);
    assert.equal(unchangedEvidence.artifacts.summary.changed, 0);

    await writeSuite(suitePath, "IMPOSSIBLE_AIDRIFT_REGRESSION_99999");
    const regression = invoke(projectDirectory, manifestPath, ["check", "--format", "json"]);
    assert.equal(regression.status, 1, regression.stderr);
    const regressionEvidence = JSON.parse(regression.stdout);
    assert.equal(regressionEvidence.passed, false);
    assert.equal(regressionEvidence.summary.regressions, 1);
    assert.equal(regressionEvidence.results[0].statistics.significant, true);

    await fs.writeFile(manifestPath, "version: [invalid\n", "utf8");
    const malformed = invoke(projectDirectory, manifestPath, ["check"]);
    assert.equal(malformed.status, 2);
    assert.match(malformed.stderr, /manifest|YAML|parse/iu);
  } finally {
    await fs.rm(projectDirectory, { recursive: true, force: true });
  }
});

async function writeSuite(suitePath, expected) {
  await fs.writeFile(
    suitePath,
    `suite: built-check-e2e
assertions:
  - id: stable-contract
    type: contains
    input: Return the mock response.
    expected_contains:
      - ${expected}
    critical: true
`,
    "utf8",
  );
}

function invoke(projectDirectory, manifestPath, args) {
  return spawnSync(process.execPath, [cliPath, "--config", manifestPath, ...args], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      AIDRIFT_OPENAI_API_KEY: "",
      AIDRIFT_ANTHROPIC_API_KEY: "",
      NO_COLOR: "1",
    },
    timeout: 30_000,
  });
}
