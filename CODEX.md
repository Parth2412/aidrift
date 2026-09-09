# CODEX.md - AIDRIFT Agent Rules

## Required Read Order

Before editing anything, read:

1. `README.md`
2. `BETA.md`
3. `SECURITY.md`
4. `tasks/lessons.md`
5. `tasks/todo.md`
6. The relevant package README and `.claude/skills/<domain>.md`

The maintainer workspace may also provide planning history under `../aidrift-docs`; use it when present, but do not make public repository instructions depend on it.

## Scope Rules

- Source code lives in this repository.
- Public runtime, package, security, and contribution docs live in this repository.
- Do not invent commands, package names, APIs, or workflow rules without checking docs and code.
- Stop and document uncertainty instead of guessing.
- Schema acceptance does not imply runtime support; reserved features must fail closed.
- Rebuild `packages/action/dist` after changing the bundled CLI or Action source.

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
pnpm test:coverage
pnpm build
pnpm docs:check
pnpm release:check
pnpm test:packed
```
