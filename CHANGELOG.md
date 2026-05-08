# Changelog

All notable changes to AIDRIFT will be documented in this file.

The project follows Semantic Versioning once public releases begin.

## Unreleased (development)

### Phase 10 — Provider Drift Probes (complete)

- Added canonical built-in probe suite (20 probes across deterministic, structural, semantic, behavioral, and performance categories).
- Added mocked-provider probe runner with baseline comparison, local cache, and bounded concurrency.
- Added `aidrift probe` command with `--category`, `--samples`, `--estimate-cost`, `--format json`, `--no-cache`, and `--concurrency` flags.
- Added `aidrift plan --probe-providers` execution path.
- Added chat-completions adapter (`POST /v1/chat/completions`) and messages-API adapter (`POST /v1/messages`) with injectable `fetch` for hermetic testing.
- Added provider registry dispatching `mock | openai | anthropic` ids.
- Added per-model cost tables for both live adapters.
- Added `--provider {mock|openai|anthropic}` flag to `aidrift probe` and `aidrift plan --probe-providers`. Default is `mock`.
- Added fast-fail exit 2 for missing API key env var when a live provider is selected; error message names the missing variable and links to `docs/development/probe-costs.md`.
- Added pre-run cost estimate printed before any live API call; requires `--yes` or `--cost-budget=<dollars>` to proceed.
- Added `docs/development/probe-costs.md` with per-probe cost expectations, default models, price tables, and cost-capping strategies.
- Added integration tests (auto-skipped in CI) for both live adapters via env-var guard.
- All hermetic tests run without network access; 165 tests total.

### Phase 9 — Eval Runner and `aidrift plan`

- Added assertion suite YAML schema and parser with YAML line-number error reporting.
- Added `contains`, `regex`, and `json_schema` assertion evaluators.
- Added deterministic offline mock provider (no HTTP, no network).
- Added baseline-aware eval runner with bounded concurrency (default 4) and stable sorted output.
- Added `aidrift plan` command with `--dry-run`, `--format json`, `--save`, `--allow-regression`, and `--probe-providers` (Phase 10 stub).
- Exported eval and provider public surface through `@aidrift/core` and `@aidrift/sdk`.
- Added eval/provider/runner/CLI plan tests (106 tests total).

### Phase 7 + 8 — Snapshot, History, and Diff

- Added SHA-256 hasher and snapshot schema (`packages/core/src/snapshot/`).
- Added local snapshot storage under `.aidrift/snapshots/`.
- Added git metadata capture on snapshot.
- Added `aidrift snapshot` command with `--label` flag.
- Added `aidrift history` command.
- Added text, JSON/YAML semantic, binary hash, and model parameter diff engines.
- Added `aidrift diff` command with `--format json` support.

### Phase 6 — Init and Context Sync

- Added project scanner that detects prompt files, model configs, tool schemas, RAG configs, and safety rules.
- Added `aidrift init` command with `--dry-run`, `--yes`, `--template`, and `--dir` flags.
- Added built-in templates: `basic-llm`, `rag-pipeline`, `agent`.

### Phase 5 — Manifest System

- Added `.aistate.yml` v1 JSON Schema and TypeScript types.
- Added YAML parser with line-number error reporting.
- Added path resolver (all artifact paths resolved relative to manifest location).
- Added secret pattern detector (rejects keys/tokens in manifest).
- Added strict mode with unpinned-model warnings.
- Added `aidrift validate` command.

### Phase 4 — Core CLI Foundation

- Added `aidrift` executable with `--help`, `--version`, `--config`, `--verbose`, `--debug`, `--quiet`, `--no-color`, and `--format` global options.
- Added config resolution: CLI flags → env vars → manifest → defaults.
- Added structured logger with secret redaction (API keys, bearer tokens, GitHub tokens).
- Added typed error classes with exit codes (0 success, 1 regression/failure, 2 config error).
- Added `@aidrift/sdk` plugin interface scaffolding.

## 0.0.0

- Repository bootstrap: pnpm/Turborepo monorepo, TypeScript strict mode, CI workflow, commit hook, PR template, CODEOWNERS.
