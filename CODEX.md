# CODEX.md - AIDRIFT Agent Rules

## Required Read Order

Before editing anything, read:

1. `../aidrift-docs/PROJECT-CONTEXT.md`
2. `../aidrift-docs/AGENT-RULES.md`
3. `../aidrift-docs/ARCHITECTURE-PLAN.md`
4. `../aidrift-docs/FOLDER-STRUCTURE.md`
5. `../aidrift-docs/TASKS.md`
6. `../aidrift-docs/PROGRESS.md`
7. Relevant phase file in `../aidrift-docs/PHASES/`

## Scope Rules

- Source code lives in this repository.
- Planning and product docs live in `../aidrift-docs`.
- Do not invent commands, package names, APIs, or workflow rules without checking docs and code.
- Stop and document uncertainty instead of guessing.

## Git Identity

Repository-local Git identity is configured as:

```text
user.name=Parth2412
user.email=kaloliya@gmail.com
```

Do not change it unless Parth explicitly asks.

## Commit Policy

No co-authored commits are allowed.

Never add:

```text
Co-authored-by:
```

Never add commit footers naming Claude, Codex, OpenAI, Anthropic, or any AI assistant.

This repo has a commit hook at `.githooks/commit-msg`. If it is not active, run:

```bash
./scripts/install-git-hooks.sh
```

## Validation

Before marking work complete, run the relevant checks:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
