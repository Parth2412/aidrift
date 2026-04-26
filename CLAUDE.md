# CLAUDE.md - AIDRIFT Agent Brain

## Project Identity

AIDrift is an open-source, language-agnostic CLI that versions the complete behavioral specification of an AI system — prompts, models, RAG configs, tool schemas, safety rules, and adapter weights — as a single diffable artifact. It detects behavioral drift from both developer changes and silent provider model updates, and gates deployments via CI/CD.

**One-line pitch:** "Terraform for AI behavior — version, test, and gate your AI system's behavior."

**Owner:** Parth (ZettaCore) | **License:** Apache 2.0 | **Language:** TypeScript (Node.js)

**Workflow:** `init → snapshot → diff → plan → check` (Terraform-familiar)

**Monorepo:** pnpm + Turborepo with `packages/cli`, `packages/core`, `packages/sdk`, `packages/action`, future `packages/python`, `plugins/`, `examples/`, `docs/`

---

## Required Read Order

Before touching files, read:

1. `../aidrift-docs/PROJECT-CONTEXT.md`
2. `../aidrift-docs/AGENT-RULES.md`
3. `../aidrift-docs/ARCHITECTURE-PLAN.md`
4. `../aidrift-docs/FOLDER-STRUCTURE.md`
5. `../aidrift-docs/TASKS.md`
6. `../aidrift-docs/PROGRESS.md`
7. Relevant phase file in `../aidrift-docs/PHASES/`
8. `tasks/lessons.md`
9. `tasks/todo.md`

---

## Directory Ownership

- Product docs and plans live in `../aidrift-docs`.
- Source code and package-required docs live in this repo.
- Do not put source code in `../aidrift-docs`.
- Do not put planning docs in packages unless they are package-required docs.

---

## Workflow

### 1. Plan First

- Enter plan mode for any non-trivial task (3+ steps)
- Write plan to `tasks/todo.md` before implementing
- If something goes wrong, STOP and re-plan — never push through

### 2. Subagent Strategy

- Use subagents to keep main context clean
- One task per subagent
- Throw more compute at hard problems

### 3. Self-Improvement Loop

- After any correction: update `tasks/lessons.md`
- Format: `[date] | severity | what went wrong | rule to prevent it`
- Review lessons at every session start

### 4. Verification Standard

- Never mark complete without proving it works
- Run tests, check logs, diff behavior
- Ask: "Would a staff engineer approve this?"

### 5. Demand Elegance

- For non-trivial changes: is there a more elegant solution?
- If a fix feels hacky: rebuild it properly
- Don't over-engineer simple things

### 6. Autonomous Bug Fixing

- When given a bug: just fix it
- Go to logs, find root cause, resolve it
- No hand-holding needed

### 7. If the Plan is Wrong, Say So

- If implementation reveals the plan is flawed, STOP and surface it
- Don't silently build on a broken assumption

---

## CORE PRINCIPLES

- **Simplicity First** — touch minimal code
- **No Laziness** — root causes only, no temp fixes
- **Never Assume** — verify paths, APIs, variables before using
- **Ask Once** — one question upfront if unclear, never interrupt mid-task
- **Security Always** — API keys from env only, never in snapshots/logs, redact in debug output
- **Test Everything** — 90%+ coverage target, unit + integration + snapshot + property-based tests
- **No Co-Authors** — commits must be authored only by Parth's configured Git identity

---

## Commit Policy

No co-authored commits are allowed.

Never add:

```text
Co-authored-by:
```

Never add footers naming Claude, Codex, OpenAI, Anthropic, or any AI assistant.

This checkout uses `.githooks/commit-msg` to reject prohibited commit messages. If hooks are not active, run:

```bash
./scripts/install-git-hooks.sh
```

The repository-local Git identity must remain:

```text
user.name=Parth2412
user.email=kaloliya@gmail.com
```

---

## TASK MANAGEMENT

1. **Plan** → `../aidrift-docs/TASKS.md` and `tasks/todo.md` when task-local detail is needed
2. **Verify** → confirm before implementing
3. **Track** → mark complete as you go
4. **Explain** → high-level summary each step
5. **Learn** → `tasks/lessons.md` after corrections

---

## CODE CONVENTIONS

- TypeScript strict mode everywhere
- ESLint + Prettier (project config)
- `commander` for CLI commands, `inquirer` for interactive prompts
- `chalk` for colors, `ora` for spinners
- `yaml` for parsing, `ajv` for JSON Schema validation
- SHA-256 for all artifact hashing
- Errors to stderr, results to stdout
- Every error message: what went wrong + why + how to fix + docs link
- Exit codes: 0 = success, 1 = regression/failure, 2 = config error

---

## ARCHITECTURE QUICK REFERENCE

Six core engines under `packages/cli/src/`:

| Engine            | Path             | Does                                   |
| ----------------- | ---------------- | -------------------------------------- |
| Manifest Parser   | `src/manifest/`  | Parse + validate `.aistate.yml`        |
| Snapshot Engine   | `src/snapshot/`  | Hash artifacts, store JSON snapshots   |
| Diff Engine       | `src/diff/`      | Text/JSON/binary/parameter diffs       |
| Eval Runner       | `src/eval/`      | Execute assertion suites concurrently  |
| Probe Runner      | `src/probe/`     | Detect provider-side model drift       |
| Provider Adapters | `src/providers/` | Uniform interface to all LLM providers |

Plugin system (`src/plugins/`): artifact resolvers, assertion evaluators, storage backends, output formatters.

---

## SKILLS

Detailed knowledge lives in `.claude/skills/`. Read the relevant skill before working in that domain:

- `architecture.md` — monorepo structure, modules, tech stack, dependency map
- `manifest.md` — `.aistate.yml` spec, schema, parsing, validation, templates
- `snapshot-and-diff.md` — snapshot engine, diff engine, history, rollback, export
- `assertions-and-eval.md` — all 9 assertion types, eval runner, YAML schema, scoring
- `providers.md` — provider adapters, interface contracts, each provider's specifics
- `probes-and-statistics.md` — probe system, canonical probes, statistical significance
- `ci-cd.md` — check command, GitHub Action, GitLab CI, PR comments, JUnit output
- `plugins.md` — plugin SDK, loader, lifecycle, scaffold, first-party plugins
- `testing.md` — testing strategy, VCR pattern, coverage, property-based tests
- `code-review.md` — security rules, code standards, PR checklist, performance targets
- `cli-commands.md` — full CLI reference, flags, env vars, exit codes

---

## LEARNED

(Claude fills this in over time — also see `tasks/lessons.md`)
