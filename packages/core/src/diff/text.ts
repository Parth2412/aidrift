import { createPatch } from "diff";

/**
 * Returns a unified diff string, or null if content is identical.
 */
export function diffText(
  contentA: string,
  contentB: string,
  filenameA = "a",
  filenameB = "b",
): string | null {
  if (contentA === contentB) {
    return null;
  }
  const patch = createPatch(filenameA, contentA, contentB, filenameA, filenameB);
  return patch;
}
