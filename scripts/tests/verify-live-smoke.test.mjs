import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifier = path.join(repositoryRoot, "scripts", "verify-live-smoke.mjs");

test("live-smoke verifier accepts bounded evidence and rejects unsafe cost evidence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-live-smoke-test-"));
  try {
    const filename = path.join(directory, "result.json");
    const result = {
      providerId: "openai",
      requestedSamples: 1,
      totalCostUsd: 0.0001,
      unknownCostSamples: 0,
      summary: { total: 4, errors: 0 },
      results: Array.from({ length: 4 }, (_, index) => ({
        provider: "openai",
        probeId: `probe-${index}`,
        samples: [{ output: "ok", latencyMs: 1, costUsd: 0.000025 }],
      })),
    };
    await fs.writeFile(filename, `${JSON.stringify(result)}\n`, "utf8");

    const accepted = spawnSync(process.execPath, [verifier, filename, "openai", "0.001"], {
      encoding: "utf8",
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /Verified openai live smoke/u);

    await fs.writeFile(
      filename,
      `${JSON.stringify({ ...result, unknownCostSamples: 1 })}\n`,
      "utf8",
    );
    const rejected = spawnSync(process.execPath, [verifier, filename, "openai", "0.001"], {
      encoding: "utf8",
    });
    assert.notEqual(rejected.status, 0);
    assert.doesNotMatch(rejected.stderr, /"output"/u);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
