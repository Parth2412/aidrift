import { performance } from "node:perf_hooks";

import { lookupCostUsd } from "./cost-tables.js";
import { loadProviderApiKey } from "./env.js";
import { ProviderError } from "./errors.js";
import type { EvalProvider, ProviderGenerateRequest, ProviderOutput } from "./types.js";

export interface CreateAnthropicProviderOptions {
  readonly model: string;
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  readonly apiVersion?: string;
}

const PROVIDER_ID = "anthropic";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_API_VERSION = "2023-06-01";
const ENV_VAR = "AIDRIFT_ANTHROPIC_API_KEY";

interface MessagesContentBlock {
  readonly type?: string;
  readonly text?: string;
}

interface MessagesUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

interface MessagesResponse {
  readonly content?: ReadonlyArray<MessagesContentBlock>;
  readonly usage?: MessagesUsage;
  readonly model?: string;
}

export function createAnthropicProvider(options: CreateAnthropicProviderOptions): EvalProvider {
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
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  const systemPrompt = options.systemPrompt;

  return {
    id: PROVIDER_ID,
    async generate(request: ProviderGenerateRequest): Promise<ProviderOutput> {
      const url = `${baseUrl}/v1/messages`;
      const payload: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: request.input }],
      };
      if (systemPrompt !== undefined) {
        payload.system = systemPrompt;
      }
      const body = JSON.stringify(payload);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startMs = performance.now();
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": apiVersion,
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

      const parsed = (await response.json()) as MessagesResponse;
      const content = (parsed.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      const usage = parsed.usage ?? {};
      const costUsd = lookupCostUsd({
        providerId: PROVIDER_ID,
        model,
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
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
