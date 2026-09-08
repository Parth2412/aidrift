import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const actionDirectory = path.resolve(testDirectory, "..", "..");
const actionPath = path.join(actionDirectory, "dist", "index.js");
const cliPath = path.join(actionDirectory, "dist", "cli", "index.js");
const noticesPath = path.join(actionDirectory, "dist", "THIRD_PARTY_NOTICES.md");

test("checked-in Action bundle includes supplemental third-party notices", async () => {
  const notices = await fs.readFile(noticesPath, "utf8");

  assert.match(notices, /buffers.*0\.1\.1/su);
  assert.match(notices, /License: MIT|Permission is hereby granted/u);
});

test("checked-in Action bundle preserves pass, regression, and config-error exits", async () => {
  const projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-built-action-"));
  const runnerTemporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "aidrift-built-action-runner-"),
  );
  const manifestPath = path.join(projectDirectory, ".aistate.yml");
  const suitePath = path.join(projectDirectory, "evals", "behavior.assertions.yml");

  try {
    await fs.mkdir(path.dirname(suitePath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `version: "1"
name: built-action-e2e
artifacts:
  models:
    primary:
      type: model
      provider: mock
      model: mock-v1
eval:
  suite: ./evals
  samples_per_assertion: 5
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
    const baseline = invoke(cliPath, projectDirectory, [
      "--config",
      manifestPath,
      "snapshot",
      "--with-evals",
      "--with-probes",
      "--provider",
      "mock",
      "--samples",
      "5",
    ]);
    assert.equal(baseline.status, 0, baseline.stderr);

    const pass = invokeAction(projectDirectory, runnerTemporaryDirectory, manifestPath);
    assert.equal(pass.status, 0, `${pass.stderr}\n${pass.stdout}`);

    await writeSuite(suitePath, "IMPOSSIBLE_AIDRIFT_ACTION_REGRESSION_99999");
    const regression = invokeAction(projectDirectory, runnerTemporaryDirectory, manifestPath);
    assert.equal(regression.status, 1, `${regression.stderr}\n${regression.stdout}`);

    await fs.writeFile(manifestPath, "version: [invalid\n", "utf8");
    const malformed = invokeAction(projectDirectory, runnerTemporaryDirectory, manifestPath);
    assert.equal(malformed.status, 2, `${malformed.stderr}\n${malformed.stdout}`);
  } finally {
    await fs.rm(projectDirectory, { recursive: true, force: true });
    await fs.rm(runnerTemporaryDirectory, { recursive: true, force: true });
  }
});

async function writeSuite(suitePath, expected) {
  await fs.writeFile(
    suitePath,
    `suite: built-action-e2e
assertions:
  - id: stable-action-contract
    type: contains
    input: Return the mock response.
    expected_contains:
      - ${expected}
    critical: true
`,
    "utf8",
  );
}

function invokeAction(projectDirectory, runnerTemporaryDirectory, manifestPath) {
  return spawnSync(process.execPath, [actionPath], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: "push",
      GITHUB_REPOSITORY: "owner/repository",
      GITHUB_RUN_ID: "123",
      GITHUB_SERVER_URL: "https://github.com",
      RUNNER_TEMP: runnerTemporaryDirectory,
      INPUT_MANIFEST: manifestPath,
      "INPUT_COMMENT-MODE": "none",
      "INPUT_UPLOAD-ARTIFACT": "false",
      NO_COLOR: "1",
    },
    timeout: 30_000,
  });
}

function invoke(executable, projectDirectory, args) {
  return spawnSync(process.execPath, [executable, ...args], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 30_000,
  });
}
