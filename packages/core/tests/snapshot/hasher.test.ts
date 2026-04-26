import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { hashString, hashFile, HASH_PREFIX } from "../../src/snapshot/hasher.js";

describe("hashString", () => {
  it("produces sha256:<hex> prefixed output", () => {
    const result = hashString("hello");
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("matches known SHA-256 value", () => {
    const expected =
      "sha256:" +
      createHash("sha256").update("hello", "utf8").digest("hex");
    expect(hashString("hello")).toBe(expected);
  });

  it("different inputs produce different hashes", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("empty string hashes consistently", () => {
    expect(hashString("")).toBe(hashString(""));
  });
});

describe("hashFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-hasher-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("hashes a file and returns sha256:<hex>", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await fs.writeFile(filePath, "file content", "utf8");
    const result = await hashFile(filePath);
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("same content produces same hash regardless of filename", async () => {
    const a = path.join(tmpDir, "a.txt");
    const b = path.join(tmpDir, "b.txt");
    await fs.writeFile(a, "same content", "utf8");
    await fs.writeFile(b, "same content", "utf8");
    expect(await hashFile(a)).toBe(await hashFile(b));
  });

  it("different content produces different hashes", async () => {
    const a = path.join(tmpDir, "a.txt");
    const b = path.join(tmpDir, "b.txt");
    await fs.writeFile(a, "content a", "utf8");
    await fs.writeFile(b, "content b", "utf8");
    expect(await hashFile(a)).not.toBe(await hashFile(b));
  });

  it("throws AIDriftError when file does not exist", async () => {
    await expect(hashFile(path.join(tmpDir, "missing.txt"))).rejects.toThrow();
  });
});

describe("HASH_PREFIX", () => {
  it("is sha256:", () => {
    expect(HASH_PREFIX).toBe("sha256:");
  });
});
