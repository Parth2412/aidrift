import { performance } from "node:perf_hooks";

import { lookupCostUsd } from "./cost-tables.js";
import { loadProviderApiKey } from "./env.js";
import { ProviderError } from "./errors.js";
import type { EvalProvider, ProviderGenerateRequest, ProviderOutput } from "./types.js";

export interface CreateOpenAIProviderOptions {
  readonly model: string;
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

const PROVIDER_ID = "openai";
const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 60_000;
const ENV_VAR = "AIDRIFT_OPENAI_API_KEY";

interface OpenAIChatChoice {
  readonly message?: { readonly content?: string | null };
}

interface OpenAIChatUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
}

interface OpenAIChatResponse {
  readonly choices?: ReadonlyArray<OpenAIChatChoice>;
  readonly usage?: OpenAIChatUsage;
  readonly model?: string;
}

export function createOpenAIProvider(options: CreateOpenAIProviderOptions): EvalProvider {
  const apiKey =
    options.apiKey ??
    loadProviderApiKey(
      options.env === undefined
        ? { envVar: ENV_VAR, providerId: PROVIDER_ID }
        : { envVar: ENV_VAR, providerId: PROVIDER_ID, env: options.env },
    );
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch;
  const model = options.model;

  return {
    id: PROVIDER_ID,
    async generate(request: ProviderGenerateRequest): Promise<ProviderOutput> {
      const url = `${baseUrl}/v1/chat/completions`;
      const body = JSON.stringify({
        model,
        messages: [{ role: "user", content: request.input }],
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startMs = performance.now();
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        throw classifyFetchError(error);
      } finally {
        clearTimeout(timer);
      }
      const latencyMs = performance.now() - startMs;

      if (!response.ok) {
        await safeReadText(response);
        throw classifyHttpError(response);
      }

      const parsed = (await response.json()) as OpenAIChatResponse;
      const content = parsed.choices?.[0]?.message?.content ?? "";
      const usage = parsed.usage ?? {};
      const costUsd = lookupCostUsd({
        providerId: PROVIDER_ID,
        model,
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
        },
      });

      return {
        content,
        latencyMs,
        costUsd,
        raw: parsed,
      };
    },
  };
}

function classifyFetchError(error: unknown): ProviderError {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new ProviderError({
      kind: "timeout",
      providerId: PROVIDER_ID,
      message: "Provider request timed out.",
      fix: "Increase the configured timeout or check network connectivity.",
      cause: error,
    });
  }
  return new ProviderError({
    kind: "network_error",
    providerId: PROVIDER_ID,
    message: "Network failure while contacting provider.",
    fix: "Check connectivity and retry.",
    cause: error,
  });
}

function classifyHttpError(response: Response): ProviderError {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new ProviderError({
      kind: "auth_invalid",
      providerId: PROVIDER_ID,
      message: `Provider rejected the request with HTTP ${status}.`,
      fix: `Verify ${ENV_VAR} is set to a valid key with sufficient permissions.`,
      httpStatus: status,
    });
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    return new ProviderError({
      kind: "rate_limit",
      providerId: PROVIDER_ID,
      message: "Provider returned HTTP 429 (rate limited).",
      fix: "Reduce request rate or wait for the limit to reset.",
      httpStatus: status,
      retryAfterMs,
    });
  }
  if (status >= 500) {
    return new ProviderError({
      kind: "server_error",
      providerId: PROVIDER_ID,
      message: `Provider returned HTTP ${status}.`,
      fix: "Retry later; this is a provider-side failure.",
      httpStatus: status,
    });
  }
  return new ProviderError({
    kind: "unknown",
    providerId: PROVIDER_ID,
    message: `Provider returned unexpected HTTP ${status}.`,
    fix: "Inspect provider docs for the status code and adjust the request.",
    httpStatus: status,
  });
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.round(seconds * 1000);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
