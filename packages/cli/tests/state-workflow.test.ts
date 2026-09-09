import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Snapshot, SnapshotDiffResult } from "@zettacore/aidrift-core";

import { runCli } from "../src/runner.js";

describe("snapshot/history/diff state workflow", () => {
  let projectDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-state-workflow-"));
    manifestPath = path.join(projectDir, ".aistate.yml");
    await fs.mkdir(path.join(projectDir, "tools", "nested"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "prompt.md"), "Be helpful.\n", "utf8");
    await fs.writeFile(path.join(projectDir, "rag.yml"), "retrieval:\n  top_k: 4\n", "utf8");
    await fs.writeFile(path.join(projectDir, "safety.yml"), "blocked: true\n", "utf8");
    await fs.writeFile(path.join(projectDir, "tools", "b.json"), '{"b":2,"a":1}\n', "utf8");
    await fs.writeFile(
      path.join(projectDir, "tools", "nested", "a.json"),
      '{"name":"lookup"}\n',
      "utf8",
    );
    await fs.writeFile(path.join(projectDir, "adapter.bin"), Buffer.from([0, 1, 2]));
    await writeManifest(0.2);
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it("captures all supported shapes in custom storage and diffs current state semantically", async () => {
    const baselineRun = await invoke(["snapshot", "--label", "baseline"]);
    expect(baselineRun.exitCode).toBe(0);
    expect(baselineRun.stderr).toBe("");

    const storageDir = path.join(projectDir, "state", "baselines");
    const files = await fs.readdir(storageDir);
    expect(files).toHaveLength(1);
    const baseline = JSON.parse(
      await fs.readFile(path.join(storageDir, files[0]!), "utf8"),
    ) as Snapshot;
    expect(Object.keys(baseline.artifacts)).toEqual([
      "adapters/weights",
      "models/primary",
      "prompts/system",
      "rag/config",
      "safety/rules",
      "tools/schemas/b.json",
      "tools/schemas/nested/a.json",
    ]);
    expect(baseline.artifacts["prompts/system"]?.path).toBe("./prompt.md");
    expect(baseline.artifacts["adapters/weights"]?.content).toBeUndefined();

    await fs.writeFile(path.join(projectDir, "prompt.md"), "Be concise.\n", "utf8");
    await fs.writeFile(path.join(projectDir, "rag.yml"), "retrieval:\n  top_k: 8\n", "utf8");
    await fs.writeFile(
      path.join(projectDir, "tools", "b.json"),
      '{\n  "a": 1,\n  "b": 2\n}\n',
      "utf8",
    );
    await fs.writeFile(path.join(projectDir, "adapter.bin"), Buffer.from([0, 1, 3]));
    await writeManifest(0.4);

    const diffRun = await invoke(["diff", "--format", "json"]);
    expect(diffRun.exitCode).toBe(0);
    expect(diffRun.stderr).toBe("");
    const diff = JSON.parse(diffRun.stdout) as SnapshotDiffResult;
    expect(diff.snapshotIdA).toBe(baseline.id);
    expect(diff.snapshotIdB).toBe("current");
    expect(
      diff.artifacts.find((artifact) => artifact.artifactKey === "rag/config")?.jsonDiff,
    ).toEqual([{ key: "retrieval.top_k", status: "modified", valueA: 4, valueB: 8 }]);
    expect(
      diff.artifacts.find((artifact) => artifact.artifactKey === "tools/schemas/b.json")?.status,
    ).toBe("unchanged");
    expect(
      diff.artifacts.find((artifact) => artifact.artifactKey === "models/primary")?.paramDiff,
    ).toEqual(
      expect.arrayContaining([
        { param: "temperature", status: "modified", valueA: 0.2, valueB: 0.4 },
      ]),
    );

    const statsRun = await invoke(["diff", "--stat", "--format", "json"]);
    const stats = JSON.parse(statsRun.stdout) as {
      readonly groups: Record<string, { readonly modified: number }>;
    };
    expect(stats.groups["prompts"]?.modified).toBe(1);
    expect(stats.groups["rag"]?.modified).toBe(1);
    expect(stats.groups["adapters"]?.modified).toBe(1);

    const markdownRun = await invoke([
      "diff",
      baseline.id,
      "--artifact",
      "rag/config",
      "--format",
      "markdown",
    ]);
    expect(markdownRun.exitCode).toBe(0);
    expect(markdownRun.stdout).toContain("## AIDRIFT Diff");
    expect(markdownRun.stdout).toContain("retrieval.top_k");

    const secondRun = await invoke(["snapshot", "--label", "updated"]);
    expect(secondRun.exitCode).toBe(0);
    expect(await fs.readdir(storageDir)).toHaveLength(2);

    const historyRun = await invoke([
      "history",
      "--labels-only",
      "--show-changes",
      "--since",
      "2026-01-01",
      "--format",
      "json",
    ]);
    expect(historyRun.exitCode).toBe(0);
    const history = JSON.parse(historyRun.stdout) as Array<{
      readonly label?: string;
      readonly changedArtifactCount: number;
      readonly changes?: { readonly modified: number };
    }>;
    expect(history.map((entry) => entry.label)).toEqual(["updated", "baseline"]);
    expect(history[0]?.changedArtifactCount).toBe(4);
    expect(history[0]?.changes?.modified).toBe(4);
  });

  async function writeManifest(temperature: number): Promise<void> {
    await fs.writeFile(
      manifestPath,
      `version: "1"
name: state-workflow
artifacts:
  prompts:
    system:
      type: prompt
      path: ./prompt.md
  models:
    primary:
      type: model
      provider: mock
      model: mock-v1
      parameters:
        temperature: ${temperature}
  rag:
    config:
      type: rag_config
      path: ./rag.yml
  tools:
    schemas:
      type: tool_schema
      path: ./tools
      glob: "**/*.json"
  safety:
    rules:
      type: safety_rules
      path: ./safety.yml
  adapters:
    weights:
      type: adapter
      path: ./adapter.bin
      hash_algorithm: sha256
eval:
  suite: ./evals
storage:
  backend: local
  path: ./state/baselines
`,
      "utf8",
    );
  }

  async function invoke(args: readonly string[]): Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }> {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const exitCode = await runCli(["node", "aidrift", ...args, "--config", manifestPath], {
      stdout: { write: (chunk) => stdoutChunks.push(chunk) },
      stderr: { write: (chunk) => stderrChunks.push(chunk) },
    });
    return {
      exitCode,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    };
  }
});
