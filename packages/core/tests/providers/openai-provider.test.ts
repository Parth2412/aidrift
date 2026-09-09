import { describe, expect, it, vi } from "vitest";

import { ProviderError } from "../../src/providers/errors.js";
import { createOpenAIProvider } from "../../src/providers/openai-provider.js";

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function successBody(content: string): unknown {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };
}

describe("createOpenAIProvider", () => {
  it("throws auth_missing before any fetch when env variable is not set", async () => {
    const fetchSpy = vi.fn();

    expect(() =>
      createOpenAIProvider({
        model: "gpt-4o-mini",
        env: {},
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      }),
    ).toThrow(ProviderError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes a 200 response into ProviderOutput with content, latency, cost and raw", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(successBody("hello world")));

    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    const output = await provider.generate({ input: "hi" });

    expect(provider.id).toBe("openai");
    expect(output.content).toBe("hello world");
    expect(output.latencyMs).toBeGreaterThanOrEqual(0);
    expect(output.costUsd).toBeCloseTo(10 * 0.15e-6 + 20 * 0.6e-6, 12);
    expect(output.raw).toMatchObject({ model: "gpt-4o-mini" });
  });

  it("sends a Bearer auth header, JSON body, and no extraneous fields", async () => {
    let captured: { url: FetchInput; init: FetchInit } | undefined;
    const fetchSpy = vi.fn(async (url: FetchInput, init: FetchInit) => {
      captured = { url, init };
      return jsonResponse(successBody("ok"));
    });

    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await provider.generate({ input: "ping" });

    expect(String(captured?.url)).toMatch(/\/v1\/chat\/completions$/);
    expect(captured?.init?.method).toBe("POST");
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(captured?.init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body).toEqual({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
    });
  });

  it("applies the declared system prompt and supported model parameters", async () => {
    let captured: FetchInit | undefined;
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      systemPrompt: "Follow the release policy.",
      parameters: { temperature: 0.2, top_p: 0.9, max_tokens: 128 },
      fetch: vi.fn(async (_url: FetchInput, init: FetchInit) => {
        captured = init;
        return jsonResponse(successBody("ok"));
      }) as unknown as typeof globalThis.fetch,
    });

    await provider.generate({ input: "ping" });

    expect(JSON.parse(String(captured?.body))).toEqual({
      model: "gpt-4o-mini",
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 128,
      messages: [
        { role: "system", content: "Follow the release policy." },
        { role: "user", content: "ping" },
      ],
    });
  });

  it("rejects unsupported or out-of-range model parameters before fetch", () => {
    const fetchSpy = vi.fn();
    expect(() =>
      createOpenAIProvider({
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        parameters: { temperature: 3 },
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      }),
    ).toThrow(/temperature/u);
    expect(() =>
      createOpenAIProvider({
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        parameters: { seed: 42 },
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      }),
    ).toThrow(/seed/u);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects unsafe direct credentials, model ids, base URLs, and request bodies", async () => {
    const fetchSpy = vi.fn();
    for (const options of [
      { model: "", apiKey: "sk-test" },
      { model: "gpt-4o-mini", apiKey: "" },
      { model: "gpt-4o-mini", apiKey: "sk-test\ninjected" },
      { model: "gpt-4o-mini", apiKey: "sk-test", baseUrl: "file:///tmp/provider" },
      { model: "gpt-4o-mini", apiKey: "sk-test", baseUrl: "https://user:pass@example.com" },
    ]) {
      expect(() =>
        createOpenAIProvider({
          ...options,
          fetch: fetchSpy as unknown as typeof globalThis.fetch,
        }),
      ).toThrow(ProviderError);
    }

    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });
    await expect(provider.generate({ input: "x".repeat(10 * 1024 * 1024 + 1) })).rejects.toThrow(
      ProviderError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies a 401 response as auth_invalid", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid API key" } }, { status: 401 }),
    );
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "auth_invalid",
      httpStatus: 401,
    });
  });

  it("classifies a 429 response as rate_limit and parses retry-after seconds", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        { error: { message: "Rate limited" } },
        { status: 429, headers: { "retry-after": "3" } },
      ),
    );
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    let captured: ProviderError | undefined;
    try {
      await provider.generate({ input: "x" });
    } catch (error) {
      captured = error as ProviderError;
    }
    expect(captured?.kind).toBe("rate_limit");
    expect(captured?.httpStatus).toBe(429);
    expect(captured?.retryAfterMs).toBe(3_000);
  });

  it("classifies a 500 response as server_error", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: { message: "boom" } }, { status: 500 }),
    );
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "server_error",
      httpStatus: 500,
    });
  });

  it("rejects provider responses whose declared size exceeds the safety limit", async () => {
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: vi.fn(async () =>
        jsonResponse(successBody("ok"), { headers: { "content-length": "6000000" } }),
      ) as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("classifies other 4xx responses as bad_request", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: { message: "Unknown model" } }, { status: 404 }),
    );
    const provider = createOpenAIProvider({
      model: "gpt-does-not-exist",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "bad_request",
      httpStatus: 404,
    });
  });

  it.each([
    ["invalid JSON", new Response("{", { status: 200 })],
    ["missing content", jsonResponse({ choices: [] })],
  ])("classifies a successful response with %s as invalid_response", async (_label, response) => {
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: vi.fn(async () => response) as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("classifies an aborted request as timeout", async () => {
    const fetchSpy = vi.fn(async (_url: FetchInput, init: FetchInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });

    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      timeoutMs: 5,
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("keeps the timeout active while reading the response body", async () => {
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      timeoutMs: 5,
      fetch: vi.fn(async (_url: FetchInput, init: FetchInit) => {
        const signal = init?.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"choices":['));
              signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
          }),
          { status: 200 },
        );
      }) as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("rejects invalid token usage instead of producing negative cost evidence", async () => {
    const response = successBody("hi") as Record<string, unknown>;
    response.usage = { prompt_tokens: -1, completion_tokens: 20 };
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: vi.fn(async () => jsonResponse(response)) as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "hi" })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("classifies a fetch rejection as network_error", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "network_error",
    });
  });

  it("never echoes a leaked API key from upstream error bodies into the thrown message", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid key sk-leakedabcdefghi" } }, { status: 401 }),
    );
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-secretkeyvalue123",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    let captured: ProviderError | undefined;
    try {
      await provider.generate({ input: "x" });
    } catch (error) {
      captured = error as ProviderError;
    }
    expect(captured?.what).not.toContain("sk-leakedabcdefghi");
    expect(captured?.what).not.toContain("sk-secretkeyvalue123");
    expect(captured?.fix).not.toContain("sk-secretkeyvalue123");
  });

  it("returns undefined cost when model is not in the cost table", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        ...(successBody("hi") as Record<string, unknown>),
        model: "gpt-future-omega",
      }),
    );
    const provider = createOpenAIProvider({
      model: "gpt-future-omega",
      apiKey: "sk-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    const output = await provider.generate({ input: "hi" });
    expect(output.costUsd).toBeUndefined();
  });

  it("returns undefined cost when provider usage evidence is missing", async () => {
    const response = successBody("hi") as Record<string, unknown>;
    delete response.usage;
    const provider = createOpenAIProvider({
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      fetch: vi.fn(async () => jsonResponse(response)) as unknown as typeof globalThis.fetch,
    });

    expect((await provider.generate({ input: "hi" })).costUsd).toBeUndefined();
  });
});
