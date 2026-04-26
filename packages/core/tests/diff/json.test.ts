import { describe, expect, it } from "vitest";

import { diffJson } from "../../src/diff/json.js";
import type { JsonDiffEntry } from "../../src/diff/types.js";

describe("diffJson", () => {
  it("returns empty array for identical objects", () => {
    expect(diffJson({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("detects modified value", () => {
    const result = diffJson({ temp: 0.2 }, { temp: 0.4 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<JsonDiffEntry>>({
      key: "temp",
      status: "modified",
      valueA: 0.2,
      valueB: 0.4,
    });
  });

  it("detects added key", () => {
    const result = diffJson({}, { newKey: "value" });
    expect(result[0]).toMatchObject<Partial<JsonDiffEntry>>({
      key: "newKey",
      status: "added",
      valueA: undefined,
      valueB: "value",
    });
  });

  it("detects removed key", () => {
    const result = diffJson({ oldKey: "value" }, {});
    expect(result[0]).toMatchObject<Partial<JsonDiffEntry>>({
      key: "oldKey",
      status: "removed",
      valueA: "value",
      valueB: undefined,
    });
  });

  it("handles nested objects as opaque values", () => {
    const result = diffJson({ nested: { x: 1 } }, { nested: { x: 2 } });
    expect(result[0]?.status).toBe("modified");
  });
});
