# Providers — LLM Provider Adapters

## When to Read This

Read before: adding a new provider adapter, modifying the provider interface, working on provider health checks, or debugging API interactions in `src/providers/`.

---

## Provider Interface (`src/providers/interface.ts`)

```typescript
interface LLMProvider {
  name: string;

  // Send a prompt and get a response
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  // Get model metadata (for versioning)
  getModelInfo(modelId: string): Promise<ModelInfo>;

  // Check if provider is reachable
  healthCheck(): Promise<boolean>;
}

interface CompletionRequest {
  model: string;
  messages: Message[];
  parameters: ModelParameters;
  tools?: ToolDefinition[];
  timeout_ms?: number;
}

interface CompletionResponse {
  content: string;
  tool_calls?: ToolCall[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  latency_ms: number;
  model_version?: string; // Actual model version returned by provider
  cost_usd: number;
}

interface ModelParameters {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  [key: string]: unknown; // Provider-specific params
}
```

---

## Supported Providers

### OpenAI (`src/providers/openai.ts`)

- SDK: `openai` ^4.x
- Env key: `AIDRIFT_OPENAI_API_KEY`
- Supports: chat completions, tool calls, JSON mode, vision
- Cost calculation: uses OpenAI's published per-token pricing
- Model version tracking: parse `model` field from response (may differ from request)
- Rate limit handling: respect `x-ratelimit-*` headers, exponential backoff
- Tool calling: maps `ToolDefinition` to OpenAI function calling format

### Anthropic (`src/providers/anthropic.ts`)

- SDK: `@anthropic-ai/sdk` ^0.x
- Env key: `AIDRIFT_ANTHROPIC_API_KEY`
- Supports: messages API, tool use, system prompts
- Quirk: system prompt is a separate field (not a message role)
- Quirk: tool_use results returned as content blocks, not separate field
- Cost calculation: per-token pricing from Anthropic docs

### Google (`src/providers/google.ts`)

- SDK: `@google/generative-ai` (when implemented)
- Env key: `AIDRIFT_GOOGLE_API_KEY`
- Supports: Gemini models
- Phase: Sprint 3 or post-launch (v0.3)

### Mistral (`src/providers/mistral.ts`)

- SDK: `@mistralai/mistralai`
- Env key: `AIDRIFT_MISTRAL_API_KEY`
- Phase: post-launch (v0.3)

### Cohere (`src/providers/cohere.ts`)

- SDK: `cohere-ai`
- Env key: `AIDRIFT_COHERE_API_KEY`
- Phase: post-launch (v0.3)

### Local (`src/providers/local.ts`)

- No SDK — uses OpenAI-compatible HTTP endpoint
- Default endpoint: `http://localhost:11434/v1` (Ollama)
- Also works with: vLLM, llama.cpp server, LocalAI, LM Studio
- No API key required (unless configured)
- No cost calculation (local inference is free)
- Critical for offline mode

### Custom HTTP (`src/providers/custom.ts`)

- Generic HTTP adapter for any endpoint
- Configured via manifest `eval.target` section
- Supports: custom URL, method, headers, body template, response path extraction
- Uses JSONPath (`response_path`) to extract text from arbitrary response shapes
- TLS certificate verification enabled by default

---

## Provider Registry (`src/providers/registry.ts`)

- Maps provider name strings to adapter classes
- Lookup: `registry.get("openai")` → `OpenAIProvider` instance
- Providers are instantiated lazily (only when first used)
- Health check runs before first API call

---

## Error Handling

Every provider adapter must:

1. Catch and classify errors: `auth_error`, `rate_limit`, `timeout`, `server_error`, `network_error`
2. Provide actionable error messages (e.g., "Set AIDRIFT_OPENAI_API_KEY environment variable")
3. Implement retry logic for transient errors (rate limits, server errors)
4. Respect `timeout_ms` from the request
5. Never expose raw API keys in error messages or logs
6. Log HTTP details at `debug` level with keys redacted

---

## Cost Calculation

Each provider adapter maintains a cost table:

```typescript
const OPENAI_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  // ...
};
```

- Cost is per-token, calculated from `usage` in the response
- Cost tables should be periodically updated (they change)
- If model not in cost table, log a warning and return `cost_usd: 0`

---

## Rules

- Every provider MUST implement the full `LLMProvider` interface — no partial implementations
- API keys are loaded from environment variables ONLY — never from config files or arguments
- Provider-specific response formats must be normalized to `CompletionResponse` — consumers never see raw provider responses
- All HTTPS, no HTTP for cloud providers
- Proxy support via `HTTPS_PROXY` environment variable
- Provider adapters must be unit-testable with mocked HTTP responses
- Never add provider-specific logic outside `src/providers/` — if something needs to know about OpenAI vs Anthropic, it goes in the adapter
