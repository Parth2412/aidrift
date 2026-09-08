# CLAUDE.md — AIDrift Repository Guide

## Project Identity

AIDrift by ZettaCore is a local-first, Git-native TypeScript CLI for versioning, diffing, testing, and gating the behavioral state of AI systems.

- Owner: Parth Kaloliya
- License: Apache-2.0
- Monorepo: pnpm + Turborepo
- Public packages: `@zettacore/aidrift`, `@zettacore/aidrift-core`, `@zettacore/aidrift-sdk`
- Private distribution package: `@zettacore/aidrift-action`
- User workflow: `init → validate → snapshot → history/diff → plan/probe → check`

The beta executes deterministic mock, OpenAI Chat Completions, and Anthropic Messages provider targets. Reserved RAG/tool/safety/adapter/custom targets, deferred assertion types, plugins, non-local storage, and drafted commands are not implemented and must fail closed.

## Required Local Reading

Before editing, read:

1. `README.md`
2. `BETA.md`
3. `SECURITY.md`
4. `tasks/lessons.md`
5. `tasks/todo.md`
6. the relevant package README and `.claude/skills/<domain>.md`

The maintainer workspace may also contain planning history in `../aidrift-docs`; use it when present, but keep this repository self-contained for public contributors and CI.

## Architecture

```text
packages/core ─┐
               ├─> packages/cli ─> packages/action bundle
packages/sdk  ─┘
```

- Core owns reusable manifest, file, snapshot, diff, eval, probe, provider, error, and redaction behavior.
- SDK owns public types and packaged JSON Schemas; it does not load plugins.
- CLI owns Commander registration, I/O, orchestration, formats, and exit mapping.
- Action owns strict inputs, bounded execution, evidence validation, artifacts/annotations/outputs, and guarded PR comments.

Do not move reusable runtime behavior into the CLI or make core/SDK depend on CLI internals.

## Engineering Rules

- Verify paths, APIs, package names, identities, versions, and external facts; do not guess.
- Keep TypeScript strict and ESM-compatible.
- Use bounded reads, execution counts, concurrency, deadlines, provider responses, evidence, and cost.
- Provider credentials come from environment variables only.
- Never log or snapshot credentials. Redaction is defense in depth.
- Preserve project path containment and atomic writes.
- Never silently ignore a schema-valid but unsupported runtime feature.
- Keep default tests hermetic; live-provider tests are explicit, credential-gated, and spend-bounded.
- Preserve CLI exit codes: `0` success/pass, `1` validation/regression failure, `2` configuration/runtime error.
- Preserve machine-readable stdout for JSON/JUnit/GitHub formats.
- Rebuild `packages/action/dist` after Action source or bundled CLI changes.

## Public Contract Changes

CLI options, manifest/snapshot/evidence schemas, baseline identity, Action inputs/outputs, package names/exports, and exit codes are versioned public contracts. A change requires implementation, negative tests, generated docs/schema updates, migration notes, packed-install verification, and Action bundle regeneration where relevant.

Run `pnpm docs:generate` after changing executable CLI registration or the manifest schema.

## Validation

Use Node 24.20.0 and pnpm 10.28.2 for release work:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm format:check
pnpm audit:dependencies
pnpm audit:licenses
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm docs:check
pnpm test:built-cli
pnpm test:built-action
pnpm release:check
pnpm test:packed
```

Also run the dedicated eval/check coverage gates and platform smoke when their contracts change.

## Git And Commit Policy

- Branch from `development`; only `development` is promoted to `main`.
- Preserve the repository-local identity `Parth2412 <kaloliya@gmail.com>`.
- No `Co-authored-by:` or assistant/vendor attribution is allowed in commit messages.
- `.githooks/commit-msg` enforces the policy. Install it with `./scripts/install-git-hooks.sh` if `core.hooksPath` is not configured.
- Do not commit credentials, `.npmrc`, `.env*`, `.aidrift/`, coverage, or local agent configuration.

## Domain Guides

The current guides under `.claude/skills/` cover architecture, manifest, snapshot/diff, assertions/eval, providers, probes/statistics, CI/Action, plugins, testing, review, and CLI contracts. Treat executable source and generated schemas as authoritative if prose ever diverges.
