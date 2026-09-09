import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { runCli } from "../src/runner.js";
import { hashString, SNAPSHOT_SCHEMA_VERSION, type Snapshot } from "@zettacore/aidrift-core";

async function writeSnap(dir: string, snap: Snapshot): Promise<void> {
  const snapsDir = path.join(dir, ".aidrift", "snapshots");
  await fs.mkdir(snapsDir, { recursive: true });
  await fs.writeFile(path.join(snapsDir, `${snap.id}.json`), JSON.stringify(snap), "utf8");
}

const MINIMAL_MANIFEST = `
version: "1"
name: test-project
artifacts: {}
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`;

describe("aidrift diff", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-cli-diff-"));
    await fs.writeFile(path.join(tmpDir, ".aistate.yml"), MINIMAL_MANIFEST, "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("compares the latest snapshot with current state when one snapshot exists", async () => {
    const stdout = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };
    const stderr = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };

    await writeSnap(tmpDir, {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id: "snap_20260426_120000",
      timestamp: new Date().toISOString(),
      manifestHash: hashString("manifest"),
      artifacts: {},
      metadata: { cliVersion: "0.0.0", nodeVersion: process.version, os: "linux" },
    });

    const exitCode = await runCli(
      ["node", "aidrift", "diff", "-c", path.join(tmpDir, ".aistate.yml")],
      { stdout, stderr },
    );

    expect(exitCode).toBe(0);
    expect(stdout.chunks.join("")).toContain("current");
  });

  it("exits 0 when diffing two snapshots with no changes", async () => {
    const baseSnap: Snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id: "snap_20260426_110000",
      timestamp: new Date(Date.now() - 60000).toISOString(),
      manifestHash: hashString("manifest"),
      artifacts: {
        "models/primary": {
          kind: "model",
          hash: hashString("model"),
          provider: "openai",
          model: "gpt-4o",
          parameters: { temperature: 0.2 },
        },
      },
      metadata: { cliVersion: "0.0.0", nodeVersion: process.version, os: "linux" },
    };
    const laterSnap: Snapshot = {
      ...baseSnap,
      id: "snap_20260426_120000",
      timestamp: new Date().toISOString(),
    };

    await writeSnap(tmpDir, baseSnap);
    await writeSnap(tmpDir, laterSnap);

    const stdout = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };
    const stderr = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "diff",
        "-c",
        path.join(tmpDir, ".aistate.yml"),
        "snap_20260426_110000",
        "snap_20260426_120000",
      ],
      { stdout, stderr },
    );

    expect(exitCode).toBe(0);
    const output = stdout.chunks.join("");
    expect(output).toContain("No changes");
  });

  it("--format json outputs machine-readable diff", async () => {
    const snapA: Snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id: "snap_20260426_110000",
      timestamp: new Date(Date.now() - 60000).toISOString(),
      manifestHash: hashString("manifest"),
      artifacts: {
        "models/primary": {
          kind: "model",
          hash: hashString("model-old"),
          provider: "openai",
          model: "gpt-4o",
          parameters: { temperature: 0.2 },
        },
      },
      metadata: { cliVersion: "0.0.0", nodeVersion: process.version, os: "linux" },
    };
    const snapB: Snapshot = {
      ...snapA,
      id: "snap_20260426_120000",
      timestamp: new Date().toISOString(),
      artifacts: {
        "models/primary": {
          kind: "model",
          hash: hashString("model-new"),
          provider: "openai",
          model: "gpt-4o",
          parameters: { temperature: 0.4 },
        },
      },
    };

    await writeSnap(tmpDir, snapA);
    await writeSnap(tmpDir, snapB);

    const stdout = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };
    const stderr = {
      chunks: [] as string[],
      write(s: string) {
        this.chunks.push(s);
      },
    };

    await runCli(
      [
        "node",
        "aidrift",
        "diff",
        "-c",
        path.join(tmpDir, ".aistate.yml"),
        "snap_20260426_110000",
        "snap_20260426_120000",
        "--format",
        "json",
      ],
      { stdout, stderr },
    );

    const parsed = JSON.parse(stdout.chunks.join("")) as { changedCount: number };
    expect(parsed.changedCount).toBe(1);
  });

  it("fails closed for an unsupported format and a missing baseline", async () => {
    const unsupported = await executeDiff(tmpDir, ["--format", "html"]);

    expect(unsupported.exitCode).toBe(2);
    expect(unsupported.stderr).toContain("diff.format.unsupported");

    const missing = await executeDiff(tmpDir, []);

    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("diff.baseline.missing");
  });

  it("fails closed before a current-state diff can ignore a custom artifact", async () => {
    await fs.writeFile(path.join(tmpDir, "policy.txt"), "policy\n", "utf8");
    await fs.writeFile(
      path.join(tmpDir, ".aistate.yml"),
      `version: "1"
name: unsupported-current-diff
artifacts:
  custom:
    policy:
      type: custom
      path: ./policy.txt
eval:
  suite: ./evals
storage:
  backend: local
  path: ./.aidrift/snapshots
`,
      "utf8",
    );
    await writeSnap(tmpDir, {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id: "snap_20260426_120000",
      timestamp: new Date().toISOString(),
      manifestHash: hashString("manifest"),
      artifacts: {},
      metadata: { cliVersion: "0.0.0", nodeVersion: process.version, os: "linux" },
    });

    const result = await executeDiff(tmpDir, []);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("manifest.runtime.unsupported");
    expect(result.stderr).toContain("artifacts.custom");
  });

  it("renders detailed Markdown and grouped statistics", async () => {
    const base = richSnapshot("snap_20260426_110000", false);
    const current = richSnapshot("snap_20260426_120000", true);
    await writeSnap(tmpDir, base);
    await writeSnap(tmpDir, current);

    const markdown = await executeDiff(tmpDir, [base.id, current.id, "--format", "markdown"]);
    const text = await executeDiff(tmpDir, [base.id, current.id]);
    const stats = await executeDiff(tmpDir, [
      base.id,
      current.id,
      "--format",
      "markdown",
      "--stat",
    ]);
    const filtered = await executeDiff(tmpDir, [
      base.id,
      current.id,
      "--format",
      "json",
      "--artifact",
      "models/primary",
    ]);

    expect(markdown.exitCode).toBe(0);
    expect(markdown.stdout).toContain("## AIDRIFT Diff");
    expect(markdown.stdout).toContain("```diff");
    expect(markdown.stdout).toContain("temperature");
    expect(markdown.stdout).toContain("hash:");
    expect(text.stdout).toContain("Diff: snap_20260426_110000 → snap_20260426_120000");
    expect(text.stdout).toContain("~ modified  models/primary");
    expect(stats.stdout).toContain("| Group | Changed | Added | Modified | Removed | Unchanged |");
    expect(stats.stdout).toContain("| models |");
    expect(JSON.parse(filtered.stdout)).toMatchObject({ changedCount: 1, addedCount: 0 });
  });

  it("rejects an artifact selector that matches nothing", async () => {
    const base = richSnapshot("snap_20260426_110000", false);
    const current = richSnapshot("snap_20260426_120000", true);
    await writeSnap(tmpDir, base);
    await writeSnap(tmpDir, current);

    const result = await executeDiff(tmpDir, [base.id, current.id, "--artifact", "missing"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("diff.artifact.not_found");
  });
});

async function executeDiff(
  projectRoot: string,
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(
    ["node", "aidrift", "diff", "-c", path.join(projectRoot, ".aistate.yml"), ...args],
    {
      stdout: { write: (chunk) => (stdout += chunk) },
      stderr: { write: (chunk) => (stderr += chunk) },
    },
  );
  return { exitCode, stdout, stderr };
}

function richSnapshot(id: string, changed: boolean): Snapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id,
    timestamp: changed ? "2026-04-26T12:00:00.000Z" : "2026-04-26T11:00:00.000Z",
    manifestHash: hashString(changed ? "manifest-new" : "manifest-old"),
    artifacts: {
      "models/primary": {
        kind: "model",
        hash: hashString(changed ? "model-new" : "model-old"),
        provider: "mock",
        model: changed ? "mock-v2" : "mock-v1",
        parameters: { temperature: changed ? 0.8 : 0.2 },
      },
      "prompts/system": {
        kind: "text",
        hash: hashString(changed ? "new prompt\n" : "old prompt\n"),
        content: changed ? "new prompt\n" : "old prompt\n",
        contentType: "text",
      },
      "adapters/model": {
        kind: "binary",
        hash: hashString(changed ? "binary-new" : "binary-old"),
      },
      ...(changed
        ? {
            "tools/added": {
              kind: "text" as const,
              hash: hashString("added"),
              content: "added",
              contentType: "text" as const,
            },
          }
        : {}),
    },
    metadata: { cliVersion: "0.9.0-beta.1", nodeVersion: process.version, os: "linux" },
  };
}
