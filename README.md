# AIDRIFT

AIDRIFT is a local-first, Git-native CLI for versioning, diffing, testing, and gating the behavioral state of AI systems.

One-line pitch: Terraform for AI behavior.

## Current Status

All core CLI commands are implemented and merged into `development`. The following commands are available:

| Command            | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `aidrift init`     | Scaffold `.aistate.yml` for an existing AI project     |
| `aidrift validate` | Parse and validate `.aistate.yml`                      |
| `aidrift snapshot` | Capture a SHA-256 snapshot of all declared artifacts   |
| `aidrift history`  | List all local snapshots                               |
| `aidrift diff`     | Compare current state or two snapshots                 |
| `aidrift plan`     | Run offline assertion suite against snapshot baselines |

106 tests passing. Build, lint, typecheck, and format checks all green.

## Repository Rules

- Default development branch: `development`.
- Production branch: `main`.
- Work branches must use: `feature/`, `bug/`, `fix/`, `enhancement/`, `chore/`, `docs/`, or `release/`.
- No co-authored commits are allowed.
- Do not add `Co-authored-by:` footers.
- Do not add AI assistant attribution in commit messages.

## Documentation Source Of Truth

Planning and product documentation live outside this code repo at:

```text
../aidrift-docs
```

Before implementation, read:

```text
../aidrift-docs/PROJECT-CONTEXT.md
../aidrift-docs/AGENT-RULES.md
../aidrift-docs/ARCHITECTURE-PLAN.md
../aidrift-docs/FOLDER-STRUCTURE.md
../aidrift-docs/TASKS.md
../aidrift-docs/PROGRESS.md
```

## Local Setup

Use Node 22+ and pnpm.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
