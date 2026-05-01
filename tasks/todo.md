# AIDrift — Current Task Board

Canonical project task tracking now lives in `../aidrift-docs/TASKS.md` and `../aidrift-docs/PROGRESS.md`.

Use this file only for local implementation notes that are too detailed for the project-level tracker.

## Current Phase: Phase 10 — Provider Drift Probes

### In Progress

- Nothing. Ready to begin Phase 10.

### To Do

- [ ] Implement Phase 10: provider adapters (OpenAI, Anthropic), canonical probe suite, probe runner, `aidrift probe` command.
- [ ] Configure GitHub branch protection in GitHub UI (owner action required).
- [ ] Set GitHub repository default branch to `development` after branch protection is configured (owner action required).
- [ ] Review and merge or close 5 open Dependabot PRs on origin before starting Phase 10 implementation.

### Done

- [x] Git repository initialized by owner.
- [x] `main` pushed by owner.
- [x] `development` pushed by owner.
- [x] Bootstrap pnpm/Turborepo TypeScript workspace.
- [x] Add GitHub CI and PR safeguards.
- [x] Add commit hook rejecting co-author and AI attribution footers.
- [x] Install dependencies and generate lockfile.
- [x] Run validation commands.
- [x] Implement command router and documented global options.
- [x] Implement config precedence skeleton.
- [x] Implement logger and secret redaction foundation.
- [x] Implement typed errors and exit codes.
- [x] Add SDK placeholder interfaces.
- [x] Add Phase 04 tests.
- [x] Validate Phase 04 with format, lint, typecheck, test, build, and CLI smoke tests.
- [x] Push Phase 04 branch to origin.
- [x] Phase 04 merged into `development` (PR #1).
- [x] Implement manifest v1 schema/types.
- [x] Implement YAML parser, JSON Schema validator, semantic provider validation, secret detection, and path/eval suite resolver.
- [x] Implement `aidrift validate`.
- [x] Add parser and CLI validate tests.
- [x] Validate Phase 06 with format, lint, typecheck, test, build, and CLI smoke tests.
- [x] Push `feature/phase-06-manifest-system` to origin.
- [x] Phase 06 PR #2 merged into `development`.
- [x] Implement project scanner (`packages/core/src/scanner/`).
- [x] Implement `aidrift init` command (`packages/cli/src/commands/init.ts`).
- [x] Implement built-in templates (`packages/core/src/templates/`).
- [x] Run full validation (format, lint, typecheck, test, build, smoke tests).
- [x] Implement SHA-256 hasher, snapshot schema, local storage, git metadata, `aidrift snapshot`, `aidrift history`.
- [x] Implement text/JSON/binary/parameter diff engine, `aidrift diff`.
- [x] Phase 7+8 merged into `development` (PR #4).
- [x] Implement Phase 9 assertion suite schema/parser/loader for `contains`, `regex`, `json_schema`.
- [x] Implement deterministic offline mock provider and assertion evaluators.
- [x] Implement baseline-aware eval runner with bounded concurrency.
- [x] Implement `aidrift plan` with `--dry-run`, `--format json`, `--save`, `--allow-regression`, `--probe-providers` Phase 10 stub.
- [x] Export eval/provider public surface through core and SDK.
- [x] Add Phase 9 tests (106 tests total passing).
- [x] Phase 9 merged into `development` (PR #10).

---

## Sprint Deliverable

Provider drift probes and `aidrift probe` — Phase 10 of TASKS.md.

## Notes

- No co-authored commits are allowed.
- Repository-local Git identity must remain `Parth2412 <kaloliya@gmail.com>`.
