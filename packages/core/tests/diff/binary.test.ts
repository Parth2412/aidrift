import { describe, expect, it } from "vitest";

import { diffBinary } from "../../src/diff/binary.js";

describe("diffBinary", () => {
  it("returns unchanged when hashes match", () => {
    const result = diffBinary("sha256:abc", "sha256:abc");
    expect(result).toBe("unchanged");
  });

  it("returns modified when hashes differ", () => {
    const result = diffBinary("sha256:abc", "sha256:def");
    expect(result).toBe("modified");
  });
});
