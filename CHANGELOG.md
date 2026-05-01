# Changelog

All notable changes to AIDRIFT will be documented in this file.

The project follows Semantic Versioning once public releases begin.

## Unreleased (development)

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
