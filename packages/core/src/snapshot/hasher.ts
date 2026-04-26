import { createHash } from "node:crypto";
import fs from "node:fs/promises";

import { AIDriftError, ExitCode } from "../errors.js";

export const HASH_PREFIX = "sha256:";

export function hashString(content: string): string {
  const hex = createHash("sha256").update(content, "utf8").digest("hex");
  return `${HASH_PREFIX}${hex}`;
}

export async function hashFile(filePath: string): Promise<string> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (cause) {
    throw new AIDriftError({
      code: "snapshot_hash_read_error",
      exitCode: ExitCode.ConfigError,
      what: `Cannot read file for hashing: ${filePath}`,
      why: "The file does not exist or is not readable.",
      fix: `Ensure the path exists and is readable: ${filePath}`,
      cause,
    });
  }
  const hex = createHash("sha256").update(buffer).digest("hex");
  return `${HASH_PREFIX}${hex}`;
}
