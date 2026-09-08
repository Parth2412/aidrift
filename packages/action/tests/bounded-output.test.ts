import { describe, expect, it } from "vitest";

import { BoundedUtf8Collector } from "../src/bounded-output.js";

describe("BoundedUtf8Collector", () => {
  it("preserves UTF-8 split across chunks within the byte limit", () => {
    const collector = new BoundedUtf8Collector(8);
    const encoded = Buffer.from("a🙂b", "utf8");
    collector.write(encoded.subarray(0, 3));
    collector.write(encoded.subarray(3));

    expect(collector.end()).toBe("a🙂b");
    expect(collector.exceeded).toBe(false);
  });

  it("bounds retained output and reports overflow", () => {
    const collector = new BoundedUtf8Collector(4);
    collector.write(Buffer.from("abcdef", "utf8"));
    collector.write(Buffer.from("more", "utf8"));

    expect(collector.end()).toBe("abcd");
    expect(collector.exceeded).toBe(true);
  });

  it("rejects invalid byte limits", () => {
    expect(() => new BoundedUtf8Collector(0)).toThrow(RangeError);
  });
});
