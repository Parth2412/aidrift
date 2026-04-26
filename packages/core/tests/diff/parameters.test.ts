import { describe, expect, it } from "vitest";

import { diffParameters } from "../../src/diff/parameters.js";
import type { ParamDiffEntry } from "../../src/diff/types.js";

describe("diffParameters", () => {
  it("returns empty array for identical parameters", () => {
    expect(diffParameters({ temperature: 0.2 }, { temperature: 0.2 })).toEqual([]);
  });

  it("detects changed temperature", () => {
    const result = diffParameters({ temperature: 0.2 }, { temperature: 0.4 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<ParamDiffEntry>>({
      param: "temperature",
      status: "modified",
      valueA: 0.2,
      valueB: 0.4,
    });
  });

  it("detects added parameter", () => {
    const result = diffParameters({}, { max_tokens: 4096 });
    expect(result[0]).toMatchObject<Partial<ParamDiffEntry>>({
      param: "max_tokens",
      status: "added",
      valueB: 4096,
    });
  });

  it("detects removed parameter", () => {
    const result = diffParameters({ top_p: 0.9 }, {});
    expect(result[0]).toMatchObject<Partial<ParamDiffEntry>>({
      param: "top_p",
      status: "removed",
      valueA: 0.9,
    });
  });
});
