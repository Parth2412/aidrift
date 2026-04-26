# Contributing To AIDRIFT

## Required Branch Flow

- Branch from `development`.
- Use one of these prefixes: `feature/`, `bug/`, `fix/`, `enhancement/`, `chore/`, `docs/`, `release/`.
- Open pull requests back into `development`.
- Only `development` may open release pull requests into `main`.

## Commit Policy

No co-authored commits are accepted.

Do not add:

```text
Co-authored-by:
```

Do not add commit footers naming Claude, Codex, OpenAI, Anthropic, or any AI assistant.

Commits must be authored only by the repository owner's configured Git identity.

## Before Coding

Read the project source-of-truth docs:

```text
../aidrift-docs/PROJECT-CONTEXT.md
../aidrift-docs/AGENT-RULES.md
../aidrift-docs/ARCHITECTURE-PLAN.md
../aidrift-docs/FOLDER-STRUCTURE.md
../aidrift-docs/TASKS.md
../aidrift-docs/PROGRESS.md
```

## Validation

Run the relevant checks before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```
