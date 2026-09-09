# Contributing To AIDrift

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Never include credentials, private prompts/model outputs, customer data, or proprietary configuration in an issue or pull request.

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

Read the repository [README](README.md), [beta boundary](BETA.md), [security policy](SECURITY.md), and [runtime safety contract](docs/reference/safety-limits.md). Read the relevant package README before changing a public package.

Open an issue before changing CLI exit semantics, the manifest schema, evidence schemas, snapshot compatibility, package names, or the release process. Those contracts require explicit migration and release review.

## Validation

Run the relevant checks before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm audit:dependencies
pnpm audit:licenses
pnpm build
pnpm format:check
pnpm release:check
pnpm test:packed
pnpm test:platform
```
