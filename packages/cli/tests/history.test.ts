import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { runCli } from "../src/runner.js";
import type { Snapshot } from "@aidrift/core";
import { SNAPSHOT_SCHEMA_VERSION } from "@aidrift/core";

function makeSnap(id: string, label?: string): Snapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id,
    label,
    timestamp: new Date().toISOString(),
    manifestHash: "sha256:abc",
    artifacts: {},
    metadata: { cliVersion: "0.0.0", nodeVersion: process.version, os: "linux-x64" },
  };
}

const MINIMAL_MANIFEST = `
version: "1"
name: test-project
artifacts: {}
eval:
  suite: ./evals
storage:
  backend: local
  path: .aidrift
`;

describe("aidrift history", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-cli-history-"));
    await fs.writeFile(path.join(tmpDir, ".aistate.yml"), MINIMAL_MANIFEST, "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 with no snapshots and prints empty message", async () => {
    const stdout = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };
    const stderr = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };

    const exitCode = await runCli(
      ["node", "aidrift", "history", "-c", path.join(tmpDir, ".aistate.yml")],
      { stdout, stderr },
    );

    expect(exitCode).toBe(0);
    expect(stdout.chunks.join("")).toContain("No snapshots");
  });

  it("lists existing snapshots", async () => {
    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    const snap = makeSnap("snap_20260426_120000", "release-v1");
    await fs.writeFile(
      path.join(snapshotsDir, `${snap.id}.json`),
      JSON.stringify(snap),
      "utf8",
    );

    const stdout = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };
    const stderr = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };

    await runCli(
      ["node", "aidrift", "history", "-c", path.join(tmpDir, ".aistate.yml")],
      { stdout, stderr },
    );

    const output = stdout.chunks.join("");
    expect(output).toContain("snap_20260426_120000");
    expect(output).toContain("release-v1");
  });

  it("--format json outputs valid JSON array", async () => {
    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    const snap = makeSnap("snap_20260426_130000");
    await fs.writeFile(
      path.join(snapshotsDir, `${snap.id}.json`),
      JSON.stringify(snap),
      "utf8",
    );

    const stdout = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };
    const stderr = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };

    await runCli(
      ["node", "aidrift", "history", "-c", path.join(tmpDir, ".aistate.yml"), "--format", "json"],
      { stdout, stderr },
    );

    const parsed = JSON.parse(stdout.chunks.join("")) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});
