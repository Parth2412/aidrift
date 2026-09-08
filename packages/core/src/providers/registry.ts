import {
  createAnthropicProvider,
  type CreateAnthropicProviderOptions,
} from "./anthropic-provider.js";
import { ProviderError } from "./errors.js";
import { createMockProvider } from "./mock-provider.js";
import { createOpenAIProvider, type CreateOpenAIProviderOptions } from "./openai-provider.js";
import type { EvalProvider } from "./types.js";

export type ProbeProviderId = "mock" | "openai" | "anthropic";

export interface ResolveProbeProviderOptions {
  readonly providerId: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly systemPrompt?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export function resolveProbeProvider(options: ResolveProbeProviderOptions): EvalProvider {
  if (options.providerId === "mock") {
    return createMockProvider();
  }
  if (options.providerId === "openai") {
    return createOpenAIProvider(toOpenAIOptions(options));
  }
  if (options.providerId === "anthropic") {
    return createAnthropicProvider(toAnthropicOptions(options));
  }
  throw new ProviderError({
    kind: "unknown",
    providerId: options.providerId,
    message: `Unknown provider id: ${options.providerId}.`,
    fix: "Use one of: mock, openai, anthropic.",
  });
}

function toOpenAIOptions(options: ResolveProbeProviderOptions): CreateOpenAIProviderOptions {
  const model = requireModel("openai", options.model);
  const result: CreateOpenAIProviderOptions = { model };
  return assignLiveOptions(result, options);
}

function toAnthropicOptions(options: ResolveProbeProviderOptions): CreateAnthropicProviderOptions {
  const model = requireModel("anthropic", options.model);
  const result: CreateAnthropicProviderOptions = { model };
  const withSystem =
    options.systemPrompt === undefined ? result : { ...result, systemPrompt: options.systemPrompt };
  return assignLiveOptions(withSystem, options);
}

function requireModel(providerId: "openai" | "anthropic", model: string | undefined): string {
  if (model === undefined || model.trim().length === 0) {
    throw new ProviderError({
      kind: "unknown",
      providerId,
      message: `Provider ${providerId} requires a non-empty model.`,
      fix: "Pass a model name when resolving a live provider.",
    });
  }
  return model;
}

function assignLiveOptions<
  T extends {
    readonly model: string;
    readonly apiKey?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly fetch?: typeof globalThis.fetch;
    readonly baseUrl?: string;
    readonly timeoutMs?: number;
    readonly systemPrompt?: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
  },
>(target: T, options: ResolveProbeProviderOptions): T {
  let next = target;
  if (options.apiKey !== undefined) {
    next = { ...next, apiKey: options.apiKey };
  }
  if (options.env !== undefined) {
    next = { ...next, env: options.env };
  }
  if (options.fetch !== undefined) {
    next = { ...next, fetch: options.fetch };
  }
  if (options.baseUrl !== undefined) {
    next = { ...next, baseUrl: options.baseUrl };
  }
  if (options.timeoutMs !== undefined) {
    next = { ...next, timeoutMs: options.timeoutMs };
  }
  if (options.systemPrompt !== undefined) {
    next = { ...next, systemPrompt: options.systemPrompt };
  }
  if (options.parameters !== undefined) {
    next = { ...next, parameters: options.parameters };
  }
  return next;
}
