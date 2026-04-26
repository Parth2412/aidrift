import type { DiffStatus } from "./types.js";

export function diffBinary(hashA: string, hashB: string): DiffStatus {
  return hashA === hashB ? "unchanged" : "modified";
}
