# Changelog

All notable changes to AIDrift will be documented in this file.

The project follows Semantic Versioning once public releases begin.

## Unreleased (development)

### Full-system go-live hardening

- Added bounded streaming reads, file/directory/assertion cardinality ceilings, structured-data complexity limits, provider response caps, total deadlines, and globally documented safety limits so oversized or adversarial inputs fail closed.
- Rejected unsafe JavaScript regular expressions before evaluation and used an RE2-compatible engine for JSON Schema patterns to avoid catastrophic backtracking.
- Made snapshot capture validate its complete output even when called through `@zettacore/aidrift-core`, and made `aidrift init` non-overwriting writes race-safe plus force writes atomic.
- Hardened `check-output.v3` bounds and made the Action validate the complete evidence contract, including required and unknown fields, identities, statistics, cardinalities, execution bounds, and cross-field consistency.
- Added explicit TypeScript projects for core, CLI, and Action tests so test fixtures are typechecked rather than only transpiled by Vitest.
- Refreshed supported provider model IDs and request/token pricing from first-party sources on 2026-09-08; unknown models remain unpriced and provider calls are not automatically retried.
- Audited production licenses, added an allowlisted CI/release license gate, and added a deterministic supplemental MIT notice for `buffers@0.1.1` beside every rebuilt Action bundle.
- Revalidated 466 package tests, 3 script contracts, built CLI/Action fixtures, Linux Node 22.14/24.20 installed-package flows, generated docs, zero known dependency advisories, Gitleaks, Actionlint, release packages, and the 22-component CycloneDX SBOM.

### Audit remediation and GitHub workflow integration

- Added `aidrift check` as a CI-safe quality gate that reads the manifest, resolves the latest or selected snapshot baseline, runs evals and provider probes, and exits `0` pass, `1` regression, or `2` config/runtime error.
- Added non-interactive live-provider handling for `openai` and `anthropic` manifest models; missing credentials fail with exit `2` instead of prompting.
- Added baseline alias resolution for snapshot id, label, tag, and git commit prefix.
- Added stable `--format text|json|junit|github`, `--baseline`, `--output`, and `--fail-on warn|fail` contracts.
- Added versioned `check-output.v3.json` evidence with artifact state, execution bounds/costs, provider identity, sample counts, and statistical evidence; retained v1/v2 schemas for compatibility.
- Added JUnit XML, GitHub workflow annotation, JSON schema, output-file, stdout/stderr, and exit-code contract coverage for the six Phase 11 check fixtures.
- Routed check output and CLI error output through the existing secret redaction layer.
- Added fail-closed runtime guards for reserved manifest/storage/plugin/target/artifact behavior and removed implicit live-provider-to-mock fallback.
- Completed secure, immutable snapshot capture; non-default local storage; semantic current-state diff; behavioral baseline capture; real sampling; deadlines; budgets; and Fisher/Welch evidence.
- Reworked provider probes to compare all samples with category-specific exact, structural, rubric, or latency logic and honest insufficient-evidence states.
- Updated request/token cost estimation with verified provider pricing and unknown-price failure behavior.
- Replaced the placeholder GitHub Action with a checked-in Node 24 bundle that invokes the bundled CLI once, emits annotations, uploads JSON/JUnit evidence, exposes outputs, and securely upserts one bot-owned PR comment.
- Added Action fork and `pull_request_target` safeguards, unit/contract tests, an Action coverage gate, and built-bundle notice/pass/regression/config-error tests.

### Documentation generation

- Added deterministic Commander-derived CLI reference generation.
- Added manifest Markdown and JSON Schema generation from the executable schema.
- Added `pnpm docs:generate`, `pnpm docs:check`, generator tests, and CI/release staleness gates.
- Replaced bootstrap-era package descriptions and no-command output with current executable behavior.

### npm release engineering

- Prepared coordinated metadata for the public `@zettacore/aidrift`, `@zettacore/aidrift-core`, and `@zettacore/aidrift-sdk` packages. The unannounced `0.9.0-beta.0` package bootstrap precedes the first OIDC-published `0.9.0-beta.1` GitHub prerelease.
- Added full Apache-2.0 license files, explicit exports and file lists, public package metadata, Node requirements, and provenance-enabled publish settings.
- Added strict package-content allowlists, size budgets, tag/version checks, packed dependency checks, and installed-tarball CLI/core/SDK smoke tests.
- Added a protected release-published workflow that validates an immutable tag from `main` and publishes dependency packages before the CLI using npm trusted publishing with OIDC.
- Pinned the release toolchain to Node 24.20.0 and pnpm 10.28.2; npm 11.5.1 or newer is required by release validation.
- Documented the unavoidable owner-controlled first-publish bootstrap, npm trust setup, token publishing lockout, and the OIDC-only path for every subsequent release.

### Test and security gates

- Upgraded Vitest/Vite, Turbo, Glob, YAML, and vulnerable transitive resolutions; `pnpm audit` now reports zero findings at every severity.
- Added package-wide beta coverage gates, 500 generated statistical property cases, six SDK type/schema contracts, and expanded CLI output contracts.
- Expanded runtime redaction for modern registry, SCM, cloud, model-provider, bearer, structured-value, URL-password, and private-key forms.
- Added SHA-pinned Gitleaks, Dependency Review, and CodeQL workflows plus GitHub Actions Dependabot updates.
- Added CycloneDX 1.5 generation from clean-installed release tarballs and retained it as a release workflow artifact.
- Added a protected weekly live-provider smoke workflow with pinned low-cost models, 16-token output caps, serial requests, and independently verified observed USD ceilings.
- Fixed live `probe --format json` to keep stdout machine-readable, reject unsupported formats before provider spend, include workload/cost evidence, and apply `--cost-budget` to observed costs.

### Beta readiness

- Made `aidrift init` create a non-destructive starter eval suite so a new offline project can run `init`, `snapshot`, `plan`, and `check` without YAML editing.
- Added a complete `0.9.0-beta.0` offline example whose unchanged check exits `0` and supplied behavioral regression exits `1` with artifact and statistical evidence.
- Extended clean installed-tarball validation to execute both the generated first-run journey and versioned regression example.
- Added a Linux/macOS/Windows matrix for Node 22.14.0 and 24.20.0 public-package builds, clean installs, and quickstart checks.
- Added beta limitations, structured feedback and bug forms, an evidence ledger, draft release notes, and an owner release/incident runbook without claiming publication or external-user results.
- Added an enforceable community Code of Conduct and made a working private conduct-reporting channel an owner precondition for beta recruitment.

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
- Exported eval and provider public surface through `@zettacore/aidrift-core` and `@zettacore/aidrift-sdk`.
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
- Added `@zettacore/aidrift-sdk` plugin interface scaffolding.

## 0.0.0

- Repository bootstrap: pnpm/Turborepo monorepo, TypeScript strict mode, CI workflow, commit hook, PR template, CODEOWNERS.
