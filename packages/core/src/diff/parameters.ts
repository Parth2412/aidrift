import type { ParamDiffEntry } from "./types.js";

export function diffParameters(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): ParamDiffEntry[] {
  const entries: ParamDiffEntry[] = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const param of allKeys) {
    const inA = Object.prototype.hasOwnProperty.call(a, param);
    const inB = Object.prototype.hasOwnProperty.call(b, param);

    if (inA && !inB) {
      entries.push({ param, status: "removed", valueA: a[param], valueB: undefined });
    } else if (!inA && inB) {
      entries.push({ param, status: "added", valueA: undefined, valueB: b[param] });
    } else if (JSON.stringify(a[param]) !== JSON.stringify(b[param])) {
      entries.push({ param, status: "modified", valueA: a[param], valueB: b[param] });
    }
  }

  return entries;
}
