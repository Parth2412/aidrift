# Providers — Runtime Adapters

## When to Read This

Read before changing provider interfaces, request construction, response validation, identity, pricing, credentials, or live-network behavior.

## Current Interface

`packages/core/src/providers/types.ts` defines the minimal `EvalProvider` contract:

- a stable provider `id`;
- `generate({ input, assertionId?, probeId?, modelName?, signal? })`;
- bounded `content`, measured `latencyMs`, optional observed `costUsd`, and optional internal raw evidence.

Callers depend on this normalized contract and must not inspect provider-specific response objects.

## Supported Providers

- `mock`: deterministic, offline, and the default for development/tests.
- `openai`: OpenAI Chat Completions over native `fetch`; credential `AIDRIFT_OPENAI_API_KEY`.
- `anthropic`: Anthropic Messages over native `fetch`; credential `AIDRIFT_ANTHROPIC_API_KEY`.

No Google, Mistral, Cohere, local OpenAI-compatible endpoint, custom HTTP provider, SDK-based adapter, tool-call execution, or vision path is implemented. Reserved manifest provider names must fail closed when selected.

## Request Contract

- The explicit eval target selects a named model artifact and declared text prompts.
- Only the documented allowlist of provider parameters is sent.
- Model, prompt, assertion/probe, sample, timeout, concurrency, and cost identity must remain visible in evidence.
- Use HTTPS endpoints controlled by the adapter; do not accept arbitrary endpoint overrides in this release.
- Pass the run's `AbortSignal` into every request.
- Reject invalid parameters and missing credentials before network access.

## Response Contract

- Bound the HTTP body while streaming; do not call an unbounded `response.text()` on provider data.
- Validate status, content type/shape, required text, usage fields, numeric ranges, and output byte ceilings.
- Treat malformed or oversized responses as configuration/runtime failures.
- Measure latency locally and calculate observed cost only from validated usage plus a known model price.
- Sanitize provider text before exposing an error. Never include keys, authorization headers, or raw private output in normal logs.

## Costs

`packages/core/src/providers/cost-tables.ts` is a dated, source-verified table for supported model IDs. Refresh it from first-party provider pricing before release when pricing or supported IDs may have changed.

- Estimates distinguish input and output tokens.
- Unknown model pricing remains unknown; never coerce it to zero.
- A live CI check cannot pass a dollar budget when any selected cost is unknown.
- Preflight estimates and observed totals must both respect the run-wide ceiling.

## Failure And Retry Policy

Provider calls are not automatically retried in this beta. Automatic retries could amplify cost and make sample identity ambiguous. Return a classified, redacted error and let the user deliberately rerun after checking provider status and recorded spend.

## Testing Rules

- Inject `fetch` for hermetic unit and contract tests.
- Test auth, status, malformed JSON, invalid shapes, oversized/streamed bodies, aborts, parameter allowlists, identity, usage, and cost behavior.
- Keep default CI network-free. Live integration tests must be environment-gated and spend-bounded.
- Never use a live credential in fixtures, source, command arguments, or test output.
