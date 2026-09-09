import { createHash } from "node:crypto";

import type { EvalProvider, ProviderGenerateRequest, ProviderOutput } from "./types.js";

export interface CreateMockProviderOptions {
  readonly model?: string | undefined;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
  readonly systemPrompt?: string | undefined;
}

export function createMockProvider(options: CreateMockProviderOptions = {}): EvalProvider {
  const context = canonicalJson({
    model: options.model ?? "mock",
    parameters: options.parameters ?? {},
    systemPrompt: options.systemPrompt ?? "",
  });
  return {
    id: "mock",
    async generate(request: ProviderGenerateRequest): Promise<ProviderOutput> {
      if (request.signal?.aborted === true) {
        throw Object.assign(new Error("Mock provider request aborted."), { name: "AbortError" });
      }
      const digest = createHash("sha256")
        .update(context)
        .update("\0")
        .update(request.input)
        .digest("hex")
        .slice(0, 12);
      const mockValue = `mock:${digest}`;
      const wantsJson = /\bjson\b/iu.test(request.input);
      const content = wantsJson
        ? JSON.stringify({
            ok: true,
            mock: mockValue,
            input: request.input,
            systemPrompt: options.systemPrompt,
          })
        : [mockValue, options.systemPrompt, request.input].filter(Boolean).join(" ");

      return {
        content,
        latencyMs: deterministicLatencyMs(digest),
        costUsd: 0,
        raw: { digest },
      };
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function deterministicLatencyMs(digest: string): number {
  const prefix = digest.slice(0, 4);
  return 10 + (Number.parseInt(prefix, 16) % 25);
}
