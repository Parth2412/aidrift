import type { JsonDiffEntry } from "./types.js";

export function diffJson(a: Record<string, unknown>, b: Record<string, unknown>): JsonDiffEntry[] {
  const entries: JsonDiffEntry[] = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of allKeys) {
    const inA = Object.prototype.hasOwnProperty.call(a, key);
    const inB = Object.prototype.hasOwnProperty.call(b, key);

    if (inA && !inB) {
      entries.push({ key, status: "removed", valueA: a[key], valueB: undefined });
    } else if (!inA && inB) {
      entries.push({ key, status: "added", valueA: undefined, valueB: b[key] });
    } else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      entries.push({ key, status: "modified", valueA: a[key], valueB: b[key] });
    }
  }

  return entries;
}
