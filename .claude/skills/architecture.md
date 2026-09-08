# Architecture — AIDrift System Design

## When to Read This

Read before changing package boundaries, dependency direction, runtime contracts, storage, providers, or distribution.

## System Shape

AIDrift is a TypeScript/pnpm/Turborepo monorepo with four workspace packages:

```text
packages/core    @zettacore/aidrift-core     runtime engines
packages/sdk     @zettacore/aidrift-sdk      public types and JSON Schemas
packages/cli     @zettacore/aidrift          command orchestration and executable
packages/action  private workspace package   bundled GitHub Action
```

Dependency direction is strict:

```text
core ─┐
      ├─> cli ─> action bundle
sdk  ─┘
```

Core and SDK do not depend on CLI or Action internals. The Action invokes the bundled CLI once and derives all GitHub-facing outputs from the resulting v3 evidence.

## Ownership Boundaries

### Core

- Manifest schema, parsing, validation, path resolution, secret detection, and runtime-support guards.
- Bounded file reads and structured-data limits.
- Snapshot capture, schema validation, baseline resolution, atomic local storage, and hashing.
- Text, binary, model-parameter, and structured JSON/YAML diff engines.
- Assertion parsing/evaluation, sampled runs, deadlines, cost bounds, and statistical comparison.
- Canonical probes, caching, category-aware comparison, and evidence.
- Deterministic mock plus OpenAI Chat Completions and Anthropic Messages adapters.
- Central error, logging, and redaction contracts.

### SDK

- Stable consumer-facing TypeScript interfaces.
- Packaged manifest and check-output JSON Schemas.
- No runtime plugin loader or execution engine.

### CLI

- Commander registration, global configuration, I/O, format selection, and exit-code mapping.
- Command orchestration only; reusable behavior belongs in core.
- Public binary name remains `aidrift` even though the npm package is scoped.

### Action

- Strict input parsing, bounded child-process output, one CLI execution, schema-validated evidence, annotations, artifacts, outputs, and guarded PR comments.
- Checked-in `dist` is required by GitHub Actions and must be reproducibly rebuilt.
- Provider credentials enter only through environment variables.

## State And Trust Boundaries

- `.aistate.yml` is declarative, version-controlled input.
- `.aidrift/` contains local state that may include private prompt/output evidence and is ignored by default.
- Artifact paths are resolved relative to the manifest and constrained to the project boundary.
- Only local snapshot storage is executable in this release.
- Only explicit provider eval targets are executable; reserved manifest features fail closed.
- Network access occurs only through selected live provider adapters. Default tests and quickstarts use the deterministic mock.
- Provider calls have request, response, sample, concurrency, time, and cost bounds.

## Public Contracts

Treat these as coordinated versioned contracts:

- CLI options and exit codes.
- Manifest schema and runtime-supported subset.
- Snapshot schema and baseline identity.
- Eval/probe classifications and statistical evidence.
- Check-output JSON Schemas.
- Action inputs, outputs, and security behavior.
- Public package names, exports, engines, and internal dependency versions.

Schema acceptance does not imply runtime support. A reserved feature must fail explicitly until its full execution, safety, testing, and documentation contract exists.

## Distribution

- Node 24.20.0 and pnpm 10.28.2 are pinned for release production.
- Public packages support Node 22.14.0 or newer.
- npm packages use coordinated versions and strict tarball allowlists.
- The GitHub Action is distributed from `packages/action` at an immutable repository tag, not npm.
- Recurring npm publication is from an immutable `main` tag through a protected GitHub environment and npm trusted publishing.

## Architectural Rules

- Fail closed rather than silently omitting declared behavior.
- Keep all default tests hermetic and deterministic.
- Never introduce a live-provider-to-mock fallback.
- Centralize limits and validate before expensive or irreversible work.
- Keep evidence bounded, versioned, redacted, and internally consistent.
- Preserve atomic writes and validate persisted state on both write and read.
- Do not add a new provider, assertion, storage backend, target, or plugin path without end-to-end execution, negative tests, cost/security bounds, and public documentation.
