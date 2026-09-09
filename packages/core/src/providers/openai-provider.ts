import { performance } from "node:perf_hooks";

import { lookupCostUsd } from "./cost-tables.js";
import { loadProviderApiKey, validateProviderApiKey } from "./env.js";
import { ProviderError } from "./errors.js";
import { discardResponseBody, readBoundedJsonResponse } from "./http-response.js";
import type { EvalProvider, ProviderGenerateRequest, ProviderOutput } from "./types.js";

export interface CreateOpenAIProviderOptions {
  readonly model: string;
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly systemPrompt?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

const PROVIDER_ID = "openai";
const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 60_000;
const ENV_VAR = "AIDRIFT_OPENAI_API_KEY";
const MAX_REQUEST_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_PARAMETER_COUNT = 32;
const MAX_STOP_SEQUENCE_CHARACTERS = 16_384;

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
    options.apiKey === undefined
      ? loadProviderApiKey(
          options.env === undefined
            ? { envVar: ENV_VAR, providerId: PROVIDER_ID }
            : { envVar: ENV_VAR, providerId: PROVIDER_ID, env: options.env },
        )
      : validateProviderApiKey(options.apiKey, PROVIDER_ID);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw invalidParameter("timeoutMs", "must be a positive integer");
  }
  const doFetch = options.fetch ?? globalThis.fetch;
  const model = normalizeModel(options.model);
  const systemPrompt = options.systemPrompt;
  const parameters = normalizeOpenAIParameters(options.parameters ?? {});

  return {
    id: PROVIDER_ID,
    async generate(request: ProviderGenerateRequest): Promise<ProviderOutput> {
      assertRequestInput(request.input);
      const url = `${baseUrl}/v1/chat/completions`;
      const messages = [
        ...(systemPrompt === undefined ? [] : [{ role: "system", content: systemPrompt }]),
        { role: "user", content: request.input },
      ];
      const body = JSON.stringify({
        model,
        ...parameters,
        messages,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const signal =
        request.signal === undefined
          ? controller.signal
          : AbortSignal.any([request.signal, controller.signal]);
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
          signal,
        });
      } catch (error) {
        clearTimeout(timer);
        throw classifyFetchError(error);
      }
      try {
        if (!response.ok) {
          await discardResponseBody(response);
          throw classifyHttpError(response);
        }

        const parsed = await parseSuccessfulResponse(response);
        const content = parsed.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
          throw invalidResponseError(
            "Provider response did not contain choices[0].message.content as a string.",
          );
        }
        const usage = parsed.usage ?? {};
        if (
          (usage.prompt_tokens !== undefined && !isTokenCount(usage.prompt_tokens)) ||
          (usage.completion_tokens !== undefined && !isTokenCount(usage.completion_tokens))
        ) {
          throw invalidResponseError("Provider response contained invalid token usage values.");
        }
        const costUsd =
          usage.prompt_tokens !== undefined && usage.completion_tokens !== undefined
            ? lookupCostUsd({
                providerId: PROVIDER_ID,
                model,
                usage: {
                  inputTokens: usage.prompt_tokens,
                  outputTokens: usage.completion_tokens,
                },
              })
            : undefined;

        return {
          content,
          latencyMs: performance.now() - startMs,
          costUsd,
          raw: parsed,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function normalizeOpenAIParameters(
  parameters: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (Object.keys(parameters).length > MAX_PARAMETER_COUNT) {
    throw invalidParameter("parameters", `must contain at most ${MAX_PARAMETER_COUNT} entries`);
  }
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(parameters)) {
    if (name === "temperature") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw invalidParameter(name, "must be a finite number");
      }
      if (value < 0 || value > 2) {
        throw invalidParameter(name, "must be between 0 and 2");
      }
      result[name] = value;
      continue;
    }
    if (name === "top_p") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw invalidParameter(name, "must be between 0 and 1");
      }
      result[name] = value;
      continue;
    }
    if (name === "frequency_penalty" || name === "presence_penalty") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < -2 || value > 2) {
        throw invalidParameter(name, "must be between -2 and 2");
      }
      result[name] = value;
      continue;
    }
    if (name === "max_tokens" || name === "max_completion_tokens") {
      if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw invalidParameter(name, "must be a positive integer");
      }
      result[name] = value;
      continue;
    }
    if (name === "stop") {
      if (
        !(
          (typeof value === "string" && value.length <= MAX_STOP_SEQUENCE_CHARACTERS) ||
          (Array.isArray(value) &&
            value.length <= 4 &&
            value.every(
              (item) => typeof item === "string" && item.length <= MAX_STOP_SEQUENCE_CHARACTERS,
            ))
        )
      ) {
        throw invalidParameter(
          name,
          `must be a string or an array of at most four strings, each no longer than ${MAX_STOP_SEQUENCE_CHARACTERS} characters`,
        );
      }
      result[name] = value;
      continue;
    }
    throw invalidParameter(name, "is not supported by the AIDRIFT Chat Completions adapter");
  }
  if (result.max_tokens !== undefined && result.max_completion_tokens !== undefined) {
    throw invalidParameter(
      "max_tokens/max_completion_tokens",
      "cannot both be configured for one request",
    );
  }
  return result;
}

function normalizeModel(value: string): string {
  const model = value.trim();
  if (model.length === 0 || model.length > 512 || /[\0\r\n]/u.test(model)) {
    throw invalidParameter(
      "model",
      "must be a non-empty single-line value of at most 512 characters",
    );
  }
  return model;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidParameter("baseUrl", "must be a valid HTTP or HTTPS URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw invalidParameter(
      "baseUrl",
      "must use HTTP or HTTPS and must not contain credentials, a query, or a fragment",
    );
  }
  return url.toString().replace(/\/+$/u, "");
}

function assertRequestInput(input: unknown): asserts input is string {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_REQUEST_INPUT_BYTES) {
    throw invalidParameter(
      "input",
      `must be a string no larger than ${MAX_REQUEST_INPUT_BYTES} UTF-8 bytes`,
    );
  }
}

function invalidParameter(name: string, reason: string): ProviderError {
  return new ProviderError({
    kind: "bad_request",
    providerId: PROVIDER_ID,
    message: `Invalid OpenAI model parameter ${name}.`,
    fix: `Parameter ${name} ${reason}; update artifacts.models parameters.`,
  });
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
  if (status >= 400) {
    return new ProviderError({
      kind: "bad_request",
      providerId: PROVIDER_ID,
      message: `Provider rejected the request with HTTP ${status}.`,
      fix: "Verify the model ID, request parameters, and provider account permissions.",
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

async function parseSuccessfulResponse(response: Response): Promise<OpenAIChatResponse> {
  let parsed: unknown;
  try {
    parsed = await readBoundedJsonResponse(response);
  } catch (error) {
    if (isAbortError(error)) throw classifyFetchError(error);
    throw invalidResponseError(
      "Provider returned a successful response that was not valid JSON.",
      error,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidResponseError(
      "Provider returned a successful response with an invalid JSON shape.",
    );
  }
  return parsed as OpenAIChatResponse;
}

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function invalidResponseError(message: string, cause?: unknown): ProviderError {
  return new ProviderError({
    kind: "invalid_response",
    providerId: PROVIDER_ID,
    message,
    fix: "Retry the request; if the problem persists, verify the provider API compatibility.",
    cause,
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
