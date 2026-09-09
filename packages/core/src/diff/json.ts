import type { JsonDiffEntry } from "./types.js";

export function diffJson(valueA: unknown, valueB: unknown): JsonDiffEntry[] {
  const entries: JsonDiffEntry[] = [];
  visitJson(valueA, valueB, "", entries);
  return entries;
}

function visitJson(
  valueA: unknown,
  valueB: unknown,
  keyPath: string,
  entries: JsonDiffEntry[],
): void {
  if (deepEqual(valueA, valueB)) {
    return;
  }

  if (isJsonObject(valueA) && isJsonObject(valueB)) {
    const keys = [...new Set([...Object.keys(valueA), ...Object.keys(valueB)])].sort();
    for (const key of keys) {
      const childPath = keyPath.length === 0 ? key : `${keyPath}.${key}`;
      const hasA = Object.prototype.hasOwnProperty.call(valueA, key);
      const hasB = Object.prototype.hasOwnProperty.call(valueB, key);
      if (hasA && !hasB) {
        entries.push({ key: childPath, status: "removed", valueA: valueA[key] });
      } else if (!hasA && hasB) {
        entries.push({ key: childPath, status: "added", valueB: valueB[key] });
      } else {
        visitJson(valueA[key], valueB[key], childPath, entries);
      }
    }
    return;
  }

  if (Array.isArray(valueA) && Array.isArray(valueB)) {
    const length = Math.max(valueA.length, valueB.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${keyPath}[${index}]`;
      if (index >= valueB.length) {
        entries.push({ key: childPath, status: "removed", valueA: valueA[index] });
      } else if (index >= valueA.length) {
        entries.push({ key: childPath, status: "added", valueB: valueB[index] });
      } else {
        visitJson(valueA[index], valueB[index], childPath, entries);
      }
    }
    return;
  }

  entries.push({ key: keyPath || "$", status: "modified", valueA, valueB });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(valueA: unknown, valueB: unknown): boolean {
  if (Object.is(valueA, valueB)) {
    return true;
  }
  if (Array.isArray(valueA) && Array.isArray(valueB)) {
    return (
      valueA.length === valueB.length &&
      valueA.every((value, index) => deepEqual(value, valueB[index]))
    );
  }
  if (isJsonObject(valueA) && isJsonObject(valueB)) {
    const keysA = Object.keys(valueA).sort();
    const keysB = Object.keys(valueB).sort();
    return (
      keysA.length === keysB.length &&
      keysA.every((key, index) => key === keysB[index] && deepEqual(valueA[key], valueB[key]))
    );
  }
  return false;
}
