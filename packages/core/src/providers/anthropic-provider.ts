import { performance } from "node:perf_hooks";

import { lookupCostUsd } from "./cost-tables.js";
import { loadProviderApiKey, validateProviderApiKey } from "./env.js";
import { ProviderError } from "./errors.js";
import { discardResponseBody, readBoundedJsonResponse } from "./http-response.js";
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
  readonly parameters?: Readonly<Record<string, unknown>>;
}

const PROVIDER_ID = "anthropic";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_API_VERSION = "2023-06-01";
const ENV_VAR = "AIDRIFT_ANTHROPIC_API_KEY";
const MAX_REQUEST_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_PARAMETER_COUNT = 32;
const MAX_STOP_SEQUENCES = 4;
const MAX_STOP_SEQUENCE_CHARACTERS = 16_384;

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
  const parameters = normalizeAnthropicParameters(options.parameters ?? {});
  const maxTokens =
    (parameters.max_tokens as number | undefined) ?? options.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
    throw invalidParameter("maxTokens", "must be a positive integer");
  }
  const apiVersion = normalizeApiVersion(options.apiVersion ?? DEFAULT_API_VERSION);
  const systemPrompt = options.systemPrompt;

  return {
    id: PROVIDER_ID,
    async generate(request: ProviderGenerateRequest): Promise<ProviderOutput> {
      assertRequestInput(request.input);
      const url = `${baseUrl}/v1/messages`;
      const payload: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        ...parameters,
        messages: [{ role: "user", content: request.input }],
      };
      if (systemPrompt !== undefined) {
        payload.system = systemPrompt;
      }
      const body = JSON.stringify(payload);

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
            "x-api-key": apiKey,
            "anthropic-version": apiVersion,
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
        if (!Array.isArray(parsed.content)) {
          throw invalidResponseError("Provider response did not contain a content array.");
        }
        if (
          parsed.content.some(
            (block) =>
              typeof block !== "object" ||
              block === null ||
              typeof block.type !== "string" ||
              (block.type === "text" && typeof block.text !== "string"),
          )
        ) {
          throw invalidResponseError("Provider response contained an invalid content block.");
        }
        const content = parsed.content
          .filter((block) => block.type === "text")
          .map((block) => block.text as string)
          .join("");
        const usage = parsed.usage ?? {};
        if (
          (usage.input_tokens !== undefined && !isTokenCount(usage.input_tokens)) ||
          (usage.output_tokens !== undefined && !isTokenCount(usage.output_tokens))
        ) {
          throw invalidResponseError("Provider response contained invalid token usage values.");
        }
        const costUsd =
          usage.input_tokens !== undefined && usage.output_tokens !== undefined
            ? lookupCostUsd({
                providerId: PROVIDER_ID,
                model,
                usage: {
                  inputTokens: usage.input_tokens,
                  outputTokens: usage.output_tokens,
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

function normalizeAnthropicParameters(
  parameters: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (Object.keys(parameters).length > MAX_PARAMETER_COUNT) {
    throw invalidParameter("parameters", `must contain at most ${MAX_PARAMETER_COUNT} entries`);
  }
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(parameters)) {
    if (name === "temperature" || name === "top_p") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw invalidParameter(name, "must be between 0 and 1");
      }
      result[name] = value;
      continue;
    }
    if (name === "top_k" || name === "max_tokens") {
      if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw invalidParameter(name, "must be a positive integer");
      }
      result[name] = value;
      continue;
    }
    if (name === "stop_sequences") {
      if (
        !Array.isArray(value) ||
        value.length > MAX_STOP_SEQUENCES ||
        !value.every(
          (item) => typeof item === "string" && item.length <= MAX_STOP_SEQUENCE_CHARACTERS,
        )
      ) {
        throw invalidParameter(
          name,
          `must contain at most ${MAX_STOP_SEQUENCES} strings of at most ${MAX_STOP_SEQUENCE_CHARACTERS} characters`,
        );
      }
      result[name] = value;
      continue;
    }
    throw invalidParameter(name, "is not supported by the AIDRIFT Messages adapter");
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

function normalizeApiVersion(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw invalidParameter("apiVersion", "must use the YYYY-MM-DD format");
  }
  return value;
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
    message: `Invalid Anthropic model parameter ${name}.`,
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

async function parseSuccessfulResponse(response: Response): Promise<MessagesResponse> {
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
  return parsed as MessagesResponse;
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
