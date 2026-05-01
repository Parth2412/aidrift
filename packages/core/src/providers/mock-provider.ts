import { createHash } from "node:crypto";

import type { EvalProvider, ProviderGenerateRequest, ProviderOutput } from "./types.js";

export function createMockProvider(): EvalProvider {
  return {
    id: "mock",
    async generate(request: ProviderGenerateRequest): Promise<ProviderOutput> {
      const digest = createHash("sha256").update(request.input).digest("hex").slice(0, 12);
      const mockValue = `mock:${digest}`;
      const wantsJson = /\bjson\b/iu.test(request.input);
      const content = wantsJson
        ? JSON.stringify({ ok: true, mock: mockValue, input: request.input })
        : `${mockValue} ${request.input}`;

      return {
        content,
        latencyMs: deterministicLatencyMs(digest),
        raw: { digest },
      };
    },
  };
}

function deterministicLatencyMs(digest: string): number {
  const prefix = digest.slice(0, 4);
  return 10 + (Number.parseInt(prefix, 16) % 25);
}
