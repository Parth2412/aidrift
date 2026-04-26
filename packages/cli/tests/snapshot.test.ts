import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { runCli } from "../src/runner.js";

const MINIMAL_MANIFEST = `
version: "1"
name: test-project
artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o
      parameters:
        temperature: 0.2
eval:
  suite: ./evals
storage:
  backend: local
  path: .aidrift
`;

describe("aidrift snapshot", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-cli-snapshot-"));
    await fs.writeFile(path.join(tmpDir, ".aistate.yml"), MINIMAL_MANIFEST, "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 and creates a snapshot file", async () => {
    const stdout = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };
    const stderr = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };

    const exitCode = await runCli(
      ["node", "aidrift", "snapshot", "-c", path.join(tmpDir, ".aistate.yml")],
      { stdout, stderr },
    );

    expect(exitCode).toBe(0);

    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    const files = await fs.readdir(snapshotsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^snap_\d{8}_\d{6}\.json$/);
  });

  it("snapshot output contains snapshot ID", async () => {
    const stdout = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };
    const stderr = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };

    await runCli(
      ["node", "aidrift", "snapshot", "-c", path.join(tmpDir, ".aistate.yml")],
      { stdout, stderr },
    );

    const output = stdout.chunks.join("");
    expect(output).toMatch(/snap_\d{8}_\d{6}/);
  });

  it("--label flag sets the snapshot label", async () => {
    const stdout = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };
    const stderr = { chunks: [] as string[], write(s: string) { this.chunks.push(s); } };

    await runCli(
      ["node", "aidrift", "snapshot", "-c", path.join(tmpDir, ".aistate.yml"), "--label", "v1-release"],
      { stdout, stderr },
    );

    const snapshotsDir = path.join(tmpDir, ".aidrift", "snapshots");
    const files = await fs.readdir(snapshotsDir);
    const raw = await fs.readFile(path.join(snapshotsDir, files[0]!), "utf8");
    const snap = JSON.parse(raw) as { label: string };
    expect(snap.label).toBe("v1-release");
  });
});
