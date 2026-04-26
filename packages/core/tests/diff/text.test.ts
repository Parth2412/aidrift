import { describe, expect, it } from "vitest";

import { diffText } from "../../src/diff/text.js";

describe("diffText", () => {
  it("returns null when content is identical", () => {
    expect(diffText("hello world", "hello world")).toBeNull();
  });

  it("returns a unified diff string when content differs", () => {
    const result = diffText("line one\nline two\n", "line one\nline THREE\n");
    expect(result).not.toBeNull();
    expect(result).toContain("-line two");
    expect(result).toContain("+line THREE");
  });

  it("shows added lines", () => {
    const result = diffText("line one\n", "line one\nline two\n");
    expect(result).toContain("+line two");
  });

  it("shows removed lines", () => {
    const result = diffText("line one\nline two\n", "line one\n");
    expect(result).toContain("-line two");
  });
});
