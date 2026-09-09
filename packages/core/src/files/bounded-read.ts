import { open } from "node:fs/promises";

export type BoundedFileReadFailure = "not_file" | "too_large";

export class BoundedFileReadError extends Error {
  readonly failure: BoundedFileReadFailure;
  readonly limitBytes: number;

  constructor(filePath: string, failure: BoundedFileReadFailure, limitBytes: number) {
    super(
      failure === "too_large"
        ? `File exceeds the ${limitBytes}-byte read limit: ${filePath}`
        : `Path is not a regular file: ${filePath}`,
    );
    this.name = "BoundedFileReadError";
    this.failure = failure;
    this.limitBytes = limitBytes;
  }
}

export interface BoundedUtf8File {
  readonly content: string;
  readonly sizeBytes: number;
  readonly lastModified: Date;
}

export async function readUtf8FileWithinLimit(
  filePath: string,
  limitBytes: number,
): Promise<BoundedUtf8File> {
  const handle = await open(filePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new BoundedFileReadError(filePath, "not_file", limitBytes);
    }
    if (stats.size > limitBytes) {
      throw new BoundedFileReadError(filePath, "too_large", limitBytes);
    }

    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.byteLength;
      if (sizeBytes > limitBytes) {
        throw new BoundedFileReadError(filePath, "too_large", limitBytes);
      }
      chunks.push(buffer);
    }

    return {
      content: Buffer.concat(chunks, sizeBytes).toString("utf8"),
      sizeBytes,
      lastModified: stats.mtime,
    };
  } finally {
    await handle.close();
  }
}
