# AIDrift — Current Task Board

Canonical project task tracking now lives in `../aidrift-docs/TASKS.md` and `../aidrift-docs/PROGRESS.md`.

Use this file only for local implementation notes that are too detailed for the project-level tracker.

## Current Phase: M4 External Beta Gates

### To Do

- [ ] Configure the protected `provider-smoke` environment and scoped live-provider credentials.
- [ ] Recruit at least 10 external beta users, capture at least 3 actionable reports, dogfood one consent-safe public project, classify false positives/missed regressions, and complete the 14-day observation gate begun on 2026-09-09.

### Owner / Release Follow-Up

- [x] Implement Phase 10 canonical probe suite, mocked-provider probe runner, local cache, cost estimator, `aidrift probe` command, and `plan --probe-providers` execution path.
- [x] Implement live provider adapters (OpenAI, Anthropic first) using env-only credentials and mocked/recorded tests.
- [x] Wire `--provider` flag through `aidrift probe` and `aidrift plan --probe-providers` to surface the live adapter registry to end users.
- [x] Protect `main` and `development` with strict required checks, signed commits, PR-only changes, conversation resolution, and administrator enforcement.
- [x] Set `main` as the public repository default and retain `development` as the integration branch.
- [x] Authenticate the owner, clear stale credentials, and verify zero open Dependabot, CodeQL, or secret-scanning alerts at release.

### Done

- [x] Make `init` generate a starter eval suite and prove the no-YAML-edit init/validate/snapshot/plan/check journey from clean installed tarballs.
- [x] Add and test a machine-versioned offline example that exits 0 unchanged and exits 1 on the included behavioral regression.
- [x] Add a six-cell Linux/macOS/Windows × Node 22.14/24.20 package/quickstart matrix; validate Linux Node 22.14 and 24.20 locally.
- [x] Pass all six remote platform cells plus CI and security checks on exact release commit `252a01588a694088d47539e9852bfcef08aaf838`.
- [x] Publish signed GitHub prerelease `v0.9.0-beta.1`, all three npm packages under `next` with OIDC provenance, and the release-generated CycloneDX SBOM.
- [x] Verify a credential-free registry install, package signatures/attestations, imports, and the complete offline first-run workflow.
- [x] Publish the owner-approved private Code of Conduct reporting contact before external beta recruitment.
- [x] Prepare beta limitations, structured feedback/bug intake, evidence ledger, draft release notes, and owner publication/incident runbook.
- [x] Complete M3 test/security gates: zero dependency advisories, package-wide coverage, statistical property tests, SDK contracts, modern redaction, Gitleaks, Dependency Review, CodeQL, CycloneDX SBOM, SHA-pinned Actions, and spend-bounded protected provider smokes.
- [x] Complete M2 npm release engineering: coordinated prerelease metadata, strict tarball allowlists and budgets, installed-tarball smoke tests, Node 24.20.0/npm 11.5.1+ release contract, and a protected OIDC/provenance publish workflow.
- [x] Complete H1 runtime contract integrity: fail closed on unsupported features, remove implicit mock fallback, route live models explicitly, correct provider/runtime errors, use stable help links, and prove a clean build.
- [x] Complete H2 snapshot/history/diff integrity: safe custom storage, schema validation, immutable IDs, portable collection capture, semantic/current-state diff, filters/formats, and secure persistence.
- [x] Complete H3 behavioral baseline creation: executable snapshot flags, full evidence persistence, live-provider safety gates, and baseline-to-check proof.
- [x] Complete H4 eval/plan correctness: explicit prompt/model targets, sampling, filtering, timeouts, budgets, statistical distributions/evidence, version-neutral unsupported assertions, a 90% eval coverage gate, and end-to-end prompt-regression proof.
- [x] Complete H5 provider drift correctness: all-sample category comparators, computed evidence, strict identity, current token pricing, unknown-cost handling, and controlled distributions.
- [x] Complete H6 `check`: artifact evidence, CI workload/time/cost bounds, check-output v3, a 90% coverage gate, and built-CLI 0/1/2 proof.
- [x] Complete H7 GitHub workflow integration: bundled Node 24 Action, validated inputs/outputs, one-pass evidence, annotations, artifact upload, secure PR comments, coverage enforcement, and built-Action 0/1/2 proof.
- [x] Complete M1 documentation generation: executable-derived CLI/manifest references, packaged manifest schema, deterministic staleness checks, generator tests, and contract reconciliation.
- [x] Complete the low-priority full-system go-live audit: fail-closed accepted contracts, bounded parsing and provider I/O, regex/JSON Schema safety, complete Action evidence validation, direct-SDK snapshot validation, atomic initialization, typed test sources, current provider pricing, dependency/license/SBOM review, Node 22/24 installed-package proofs, and synchronized release documentation.

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

The public beta has a clean-install five-minute example, all six supported OS/runtime checks, signed release notes/tag, OIDC-proven npm packages, an SBOM, protected repository settings, a private conduct channel, and a verified anonymous registry workflow. Live-provider credentials and external beta evidence remain deliberately open.

## Notes

- No co-authored commits are allowed.
- Repository-local Git identity must remain `Parth2412 <kaloliya@gmail.com>`.
