import { createHash } from "node:crypto";
import fs from "node:fs";

import { AIDriftError, ExitCode } from "../errors.js";

export const HASH_PREFIX = "sha256:";

export function hashString(content: string): string {
  const hex = createHash("sha256").update(content, "utf8").digest("hex");
  return `${HASH_PREFIX}${hex}`;
}

export async function hashFile(
  filePath: string,
  maximumBytes = Number.MAX_SAFE_INTEGER,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("maximumBytes must be a non-negative safe integer.");
  }
  try {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of fs.createReadStream(filePath)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.byteLength;
      if (sizeBytes > maximumBytes) {
        throw new AIDriftError({
          code: "snapshot_hash_size_error",
          exitCode: ExitCode.ConfigError,
          what: `File exceeds the ${maximumBytes}-byte hashing limit: ${filePath}`,
          why: "The file grew beyond the configured snapshot capture bound while it was read.",
          fix: "Reduce the file size or narrow the captured artifact set, then retry.",
        });
      }
      hash.update(buffer);
    }
    return `${HASH_PREFIX}${hash.digest("hex")}`;
  } catch (cause) {
    if (cause instanceof AIDriftError) throw cause;
    throw new AIDriftError({
      code: "snapshot_hash_read_error",
      exitCode: ExitCode.ConfigError,
      what: `Cannot read file for hashing: ${filePath}`,
      why: "The file does not exist or is not readable.",
      fix: `Ensure the path exists and is readable: ${filePath}`,
      cause,
    });
  }
}
