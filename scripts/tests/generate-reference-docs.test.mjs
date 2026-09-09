import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { synchronizeGeneratedFiles } from "../generate-reference-docs.mjs";

test("generated reference synchronization writes, verifies, and detects stale content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-docs-test-"));
  const target = path.join(directory, "nested", "reference.md");
  const outputs = new Map([[target, "generated\n"]]);

  try {
    await synchronizeGeneratedFiles(outputs);
    assert.equal(await fs.readFile(target, "utf8"), "generated\n");
    await synchronizeGeneratedFiles(outputs, { check: true });

    await fs.writeFile(target, "stale\n", "utf8");
    await assert.rejects(
      synchronizeGeneratedFiles(outputs, { check: true }),
      /Generated references are stale/u,
    );
    assert.equal(await fs.readFile(target, "utf8"), "stale\n");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
