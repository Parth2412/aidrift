import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { runCli } from "../src/runner.js";
import { hashString, SNAPSHOT_SCHEMA_VERSION, type Snapshot } from "@zettacore/aidrift-core";

function makeSnap(id: string, label?: string): Snapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id,
    label,
    timestamp: new Date().toISOString(),
    manifestHash: hashString("manifest"),
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
  path: ./.aidrift/snapshots
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
    await fs.writeFile(path.join(snapshotsDir, `${snap.id}.json`), JSON.stringify(snap), "utf8");

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

    await runCli(["node", "aidrift", "history", "-c", path.join(tmpDir, ".aistate.yml")], {
      stdout,
      stderr,
    });

    const output = stdout.chunks.join("");
    expect(output).toContain("snap_20260426_120000");
    expect(output).toContain("release-v1");
  });

  it("--format json outputs valid JSON array", async () => {
    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    const snap = makeSnap("snap_20260426_130000");
    await fs.writeFile(path.join(snapshotsDir, `${snap.id}.json`), JSON.stringify(snap), "utf8");

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
      ["node", "aidrift", "history", "-c", path.join(tmpDir, ".aistate.yml"), "--format", "json"],
      { stdout, stderr },
    );

    const parsed = JSON.parse(stdout.chunks.join("")) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("honors AIDRIFT_CONFIG and AIDRIFT_FORMAT when CLI flags are absent", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(["node", "aidrift", "history"], {
      stdout: { write: (chunk) => stdout.push(chunk) },
      stderr: { write: (chunk) => stderr.push(chunk) },
      env: {
        AIDRIFT_CONFIG: path.join(tmpDir, ".aistate.yml"),
        AIDRIFT_FORMAT: "json",
      },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toEqual([]);
    expect(stderr).toEqual([]);
  });

  it("filters by ISO dates, labels, and limit", async () => {
    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    const snapshots = [
      { ...makeSnap("snap_20260801_120000", "august"), timestamp: "2026-08-01T12:00:00.000Z" },
      { ...makeSnap("snap_20260715_120000"), timestamp: "2026-07-15T12:00:00.000Z" },
      { ...makeSnap("snap_20260701_120000", "july"), timestamp: "2026-07-01T12:00:00.000Z" },
    ];
    for (const snapshot of snapshots) {
      await fs.writeFile(
        path.join(snapshotsDir, `${snapshot.id}.json`),
        JSON.stringify(snapshot),
        "utf8",
      );
    }
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "node",
        "aidrift",
        "history",
        "-c",
        path.join(tmpDir, ".aistate.yml"),
        "--since",
        "2026-07-01",
        "--until",
        "2026-08-01",
        "--labels-only",
        "--limit",
        "1",
        "--format",
        "json",
      ],
      {
        stdout: { write: (chunk) => stdout.push(chunk) },
        stderr: { write: (chunk) => stderr.push(chunk) },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    const parsed = JSON.parse(stdout.join("")) as Array<{ readonly label?: string }>;
    expect(parsed).toEqual([expect.objectContaining({ label: "august" })]);
  });

  it.each([
    [["--limit", "0"], "--limit"],
    [["--since", "09/02/2026"], "--since"],
    [["--format", "xml"], "--format"],
  ] as const)("rejects invalid history option %s", async (args, expected) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["node", "aidrift", "history", "-c", path.join(tmpDir, ".aistate.yml"), ...args],
      {
        stdout: { write: (chunk) => stdout.push(chunk) },
        stderr: { write: (chunk) => stderr.push(chunk) },
      },
    );

    expect(exitCode).toBe(2);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain(expected);
    expect(stderr.join("")).toContain("history.option.invalid");
  });

  it("surfaces corrupt snapshots with exit 2", async () => {
    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    await fs.writeFile(path.join(snapshotsDir, "snap_corrupt.json"), "{", "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      ["node", "aidrift", "history", "-c", path.join(tmpDir, ".aistate.yml")],
      {
        stdout: { write: (chunk) => stdout.push(chunk) },
        stderr: { write: (chunk) => stderr.push(chunk) },
      },
    );

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("snapshot.corrupt");
  });
});
