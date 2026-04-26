# AIDrift — Current Task Board

Canonical project task tracking now lives in `../aidrift-docs/TASKS.md` and `../aidrift-docs/PROGRESS.md`.

Use this file only for local implementation notes that are too detailed for the project-level tracker.

## Current Phase: Phase 6 — Init and Context Sync

### In Progress

<!-- Move tasks here when active implementation is underway -->

### To Do

- [ ] Implement project scanner (`packages/core/src/scanner/`).
- [ ] Implement `aidrift init` command (`packages/cli/src/commands/init.ts`).
- [ ] Implement built-in templates (`packages/core/src/templates/`).
- [ ] Run full validation (format, lint, typecheck, test, build, smoke tests).
- [ ] Push `feature/phase-07-init-context-sync` and open PR to `development`.
- [ ] Configure GitHub branch protection in GitHub UI.
- [ ] Set GitHub repository default branch to `development` after branch protection is configured.

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
- [x] Phase 04 merged into `development`.
- [x] Implement manifest v1 schema/types.
- [x] Implement YAML parser, JSON Schema validator, semantic provider validation, secret detection, and path/eval suite resolver.
- [x] Implement `aidrift validate`.
- [x] Add parser and CLI validate tests.
- [x] Validate Phase 06 with format, lint, typecheck, test, build, and CLI smoke tests.
- [x] Push `feature/phase-06-manifest-system` to origin.
- [x] Phase 06 PR #2 merged into `development`.

---

## Sprint Deliverable

Init command with project scanner and built-in templates — Phase 6 of TASKS.md.

## Notes

- No co-authored commits are allowed.
- Repository-local Git identity must remain `Parth2412 <kaloliya@gmail.com>`.
