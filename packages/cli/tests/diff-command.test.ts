import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { runCli } from "../src/runner.js";
import type { Snapshot } from "@aidrift/core";
import { SNAPSHOT_SCHEMA_VERSION } from "@aidrift/core";

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
  path: .aidrift
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

  it("exits 1 with error when fewer than 2 snapshots exist", async () => {
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
      manifestHash: "sha256:abc",
      artifacts: {},
      metadata: { cliVersion: "0.0.0", nodeVersion: process.version, os: "linux" },
    });

    const exitCode = await runCli(
      ["node", "aidrift", "diff", "-c", path.join(tmpDir, ".aistate.yml")],
      { stdout, stderr },
    );

    // Only 1 snapshot, so diff with prev fails
    expect(exitCode).toBe(1);
  });

  it("exits 0 when diffing two snapshots with no changes", async () => {
    const baseSnap: Snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id: "snap_20260426_110000",
      timestamp: new Date(Date.now() - 60000).toISOString(),
      manifestHash: "sha256:abc",
      artifacts: {
        "models/primary": {
          kind: "model",
          hash: "sha256:def",
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
      manifestHash: "sha256:abc",
      artifacts: {
        "models/primary": {
          kind: "model",
          hash: "sha256:old",
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
          hash: "sha256:new",
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
});
