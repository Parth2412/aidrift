const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function readBoundedJsonResponse(
  response: Response,
  maximumBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<unknown> {
  const declaredLength = parseContentLength(response.headers.get("content-length"));
  if (declaredLength !== undefined && declaredLength > maximumBytes) {
    await discardResponseBody(response);
    throw new Error(`Provider response exceeds the ${maximumBytes}-byte limit.`);
  }

  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("Provider response body is empty.");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error(`Provider response exceeds the ${maximumBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined)) as unknown;
}

export async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response classification must not be hidden by body cleanup failure.
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
