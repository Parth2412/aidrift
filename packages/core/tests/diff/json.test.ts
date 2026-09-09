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
      valueB: "value",
    });
  });

  it("detects removed key", () => {
    const result = diffJson({ oldKey: "value" }, {});
    expect(result[0]).toMatchObject<Partial<JsonDiffEntry>>({
      key: "oldKey",
      status: "removed",
      valueA: "value",
    });
  });

  it("reports nested object changes by semantic key path", () => {
    const result = diffJson({ nested: { x: 1 } }, { nested: { x: 2 } });
    expect(result).toEqual([{ key: "nested.x", status: "modified", valueA: 1, valueB: 2 }]);
  });

  it("ignores object key ordering and reports array indexes", () => {
    expect(diffJson({ b: 2, a: 1 }, { a: 1, b: 2 })).toEqual([]);
    expect(diffJson({ values: [1, 2] }, { values: [1, 3, 4] })).toEqual([
      { key: "values[1]", status: "modified", valueA: 2, valueB: 3 },
      { key: "values[2]", status: "added", valueB: 4 },
    ]);
  });
});
