import { describe, expect, it, vi } from "vitest";

import { createAnthropicProvider } from "../../src/providers/anthropic-provider.js";
import { ProviderError } from "../../src/providers/errors.js";

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

function successBody(text: string): unknown {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

describe("createAnthropicProvider", () => {
  it("throws auth_missing before any fetch when env variable is not set", async () => {
    const fetchSpy = vi.fn();

    expect(() =>
      createAnthropicProvider({
        model: "claude-haiku-4-5-20251001",
        env: {},
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      }),
    ).toThrow(ProviderError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes a 200 response into ProviderOutput with content, latency, cost, and raw", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(successBody("hello world")));

    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    const output = await provider.generate({ input: "hi" });

    expect(provider.id).toBe("anthropic");
    expect(output.content).toBe("hello world");
    expect(output.latencyMs).toBeGreaterThanOrEqual(0);
    expect(output.costUsd).toBeCloseTo(10 * 1e-6 + 20 * 5e-6, 12);
    expect(output.raw).toMatchObject({ id: "msg_test" });
  });

  it("sends x-api-key, anthropic-version, JSON body with messages and no extraneous fields", async () => {
    let captured: { url: FetchInput; init: FetchInit } | undefined;
    const fetchSpy = vi.fn(async (url: FetchInput, init: FetchInit) => {
      captured = { url, init };
      return jsonResponse(successBody("ok"));
    });

    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await provider.generate({ input: "ping" });

    expect(String(captured?.url)).toMatch(/\/v1\/messages$/);
    expect(captured?.init?.method).toBe("POST");
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("x-api-key")).toBe("sk-ant-test");
    expect(headers.get("anthropic-version")).toBeTruthy();
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: "ping" }],
    });
    expect(body.system).toBeUndefined();
    expect(typeof body.max_tokens).toBe("number");
  });

  it("places a system prompt in the top-level system field, not as a message", async () => {
    let captured: FetchInit | undefined;
    const fetchSpy = vi.fn(async (_url: FetchInput, init: FetchInit) => {
      captured = init;
      return jsonResponse(successBody("ok"));
    });

    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      systemPrompt: "Be terse.",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await provider.generate({ input: "ping" });

    const body = JSON.parse(String(captured?.body)) as Record<string, unknown>;
    expect(body.system).toBe("Be terse.");
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
  });

  it("applies supported model parameters to the request", async () => {
    let captured: FetchInit | undefined;
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      parameters: { temperature: 0.2, top_p: 0.9, top_k: 20, max_tokens: 128 },
      fetch: vi.fn(async (_url: FetchInput, init: FetchInit) => {
        captured = init;
        return jsonResponse(successBody("ok"));
      }) as unknown as typeof globalThis.fetch,
    });

    await provider.generate({ input: "ping" });

    expect(JSON.parse(String(captured?.body))).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      temperature: 0.2,
      top_p: 0.9,
      top_k: 20,
      max_tokens: 128,
    });
  });

  it("rejects unsupported or out-of-range model parameters before fetch", () => {
    const fetchSpy = vi.fn();
    expect(() =>
      createAnthropicProvider({
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-test",
        parameters: { top_p: 2 },
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      }),
    ).toThrow(/top_p/u);
    expect(() =>
      createAnthropicProvider({
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-test",
        parameters: { seed: 42 },
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      }),
    ).toThrow(/seed/u);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects unsafe construction values and oversized stop collections", () => {
    const fetchSpy = vi.fn();
    for (const options of [
      { model: "", apiKey: "sk-ant-test" },
      { model: "claude-haiku-4-5-20251001", apiKey: "" },
      {
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-test\ninjected",
      },
      {
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-test",
        baseUrl: "ftp://example.com",
      },
      {
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-test",
        apiVersion: "latest",
      },
      {
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-test",
        parameters: { stop_sequences: ["1", "2", "3", "4", "5"] },
      },
    ]) {
      expect(() =>
        createAnthropicProvider({
          ...options,
          fetch: fetchSpy as unknown as typeof globalThis.fetch,
        }),
      ).toThrow(ProviderError);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("joins multiple text content blocks and ignores tool_use blocks for content", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        ...(successBody("ignored") as Record<string, unknown>),
        content: [
          { type: "text", text: "part-one " },
          { type: "tool_use", id: "tool_1", name: "lookup", input: {} },
          { type: "text", text: "part-two" },
        ],
      }),
    );

    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    const output = await provider.generate({ input: "x" });
    expect(output.content).toBe("part-one part-two");
  });

  it("classifies a 401 response as auth_invalid", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid API key" } }, { status: 401 }),
    );
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
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
        { status: 429, headers: { "retry-after": "7" } },
      ),
    );
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
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
    expect(captured?.retryAfterMs).toBe(7_000);
  });

  it("rejects provider responses whose declared size exceeds the safety limit", async () => {
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      fetch: vi.fn(async () =>
        jsonResponse(successBody("ok"), { headers: { "content-length": "6000000" } }),
      ) as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("classifies a 503 response as server_error", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: { message: "boom" } }, { status: 503 }),
    );
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "server_error",
      httpStatus: 503,
    });
  });

  it("classifies other 4xx responses as bad_request", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: { message: "Unknown model" } }, { status: 404 }),
    );
    const provider = createAnthropicProvider({
      model: "claude-does-not-exist",
      apiKey: "sk-ant-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "bad_request",
      httpStatus: 404,
    });
  });

  it.each([
    ["invalid JSON", new Response("{", { status: 200 })],
    ["missing content", jsonResponse({ usage: {} })],
  ])("classifies a successful response with %s as invalid_response", async (_label, response) => {
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
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

    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      timeoutMs: 5,
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    await expect(provider.generate({ input: "x" })).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("keeps the timeout active while reading the response body", async () => {
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      timeoutMs: 5,
      fetch: vi.fn(async (_url: FetchInput, init: FetchInit) => {
        const signal = init?.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"content":['));
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
    response.usage = { input_tokens: 10, output_tokens: -1 };
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
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

    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
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
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-secretvalue123",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    let captured: ProviderError | undefined;
    try {
      await provider.generate({ input: "x" });
    } catch (error) {
      captured = error as ProviderError;
    }
    expect(captured?.what).not.toContain("sk-leakedabcdefghi");
    expect(captured?.what).not.toContain("sk-ant-secretvalue123");
    expect(captured?.fix).not.toContain("sk-ant-secretvalue123");
  });

  it("returns undefined cost when model is not in the cost table", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        ...(successBody("hi") as Record<string, unknown>),
        model: "claude-omega-2099",
      }),
    );
    const provider = createAnthropicProvider({
      model: "claude-omega-2099",
      apiKey: "sk-ant-test",
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    const output = await provider.generate({ input: "hi" });
    expect(output.costUsd).toBeUndefined();
  });

  it("returns undefined cost when provider usage evidence is missing", async () => {
    const response = successBody("hi") as Record<string, unknown>;
    delete response.usage;
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-test",
      fetch: vi.fn(async () => jsonResponse(response)) as unknown as typeof globalThis.fetch,
    });

    expect((await provider.generate({ input: "hi" })).costUsd).toBeUndefined();
  });
});
