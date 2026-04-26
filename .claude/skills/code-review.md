# Code Review — Security, Standards, and Quality

## When to Read This

Read before: reviewing code, submitting PRs, making security-sensitive changes, or when unsure about code standards.

---

## Security Rules (Non-Negotiable)

### API Key Handling

- API keys are loaded from ENVIRONMENT VARIABLES ONLY
- Keys are NEVER stored in: snapshots, config files, logs, error messages, test fixtures
- Debug output (`--debug`) MUST redact API keys automatically
- Regex pattern for redaction: mask any string matching `sk-`, `key-`, or known provider key prefixes
- Key env vars: `AIDRIFT_OPENAI_API_KEY`, `AIDRIFT_ANTHROPIC_API_KEY`, `AIDRIFT_GOOGLE_API_KEY`, `AIDRIFT_MISTRAL_API_KEY`, `AIDRIFT_COHERE_API_KEY`

### Snapshot Security

- `.aidrift/` directory MUST be gitignored (auto-configured by `aidrift init`)
- Snapshots may contain prompt content — treat `.aidrift/snapshots/` as SENSITIVE
- Export archives can be encrypted with AES-256 (`--encrypt`)
- Future: snapshot signing with GPG/sigstore (Phase 4)

### Network Security

- All provider API calls use HTTPS — never HTTP for cloud providers
- Custom HTTP endpoints support TLS certificate verification
- Proxy support via `HTTPS_PROXY` environment variable

### Plugin Security

- Plugins execute in the same process (no sandboxing in v1)
- Warn users when installing unverified plugins
- Never `eval()` or `Function()` plugin code — use `require()` / `import()`

---

## Code Standards

### TypeScript

- Strict mode enabled (`"strict": true` in tsconfig.json)
- No `any` types — use `unknown` and narrow, or define proper interfaces
- All public functions have JSDoc comments
- Prefer `interface` over `type` for object shapes
- Use `const` assertions for literal types
- Errors are typed — use custom error classes, not raw `throw new Error()`

### File Organization

- One command per file in `src/commands/`
- One assertion evaluator per file in `src/eval/assertions/`
- One provider adapter per file in `src/providers/`
- Shared types go in `types.ts` within their module directory
- Utilities go in `src/utils/` — never inline utility logic in command files

### Error Handling

Every error message MUST include:

1. **What** went wrong
2. **Why** it happened
3. **How** to fix it
4. **Link** to relevant documentation section

Example:

```
Error: OpenAI API authentication failed.
  Reason: AIDRIFT_OPENAI_API_KEY environment variable is not set.
  Fix: export AIDRIFT_OPENAI_API_KEY="sk-..."
  Docs: https://docs.aidrift.dev/guides/api-keys
```

### I/O Conventions

- Errors → stderr
- Results → stdout
- This enables piping: `aidrift check --format json | jq .status`
- Interactive prompts go to stderr (stdout stays clean for piping)

### Logging

- Use structured logger (pino or similar)
- Levels: error, warn, info, debug, trace
- Default level: `warn` (override via `AIDRIFT_LOG_LEVEL`)
- `--verbose` = info, `--debug` = debug
- ALWAYS redact API keys in log output

---

## Performance Targets

| Operation                                | Target                                |
| ---------------------------------------- | ------------------------------------- |
| `aidrift init`                           | < 10s                                 |
| `aidrift snapshot`                       | < 5s (excluding large binary hashing) |
| `aidrift diff`                           | < 2s (local operation)                |
| `aidrift plan` (5 assertions, 5 samples) | < 60s                                 |
| `aidrift probe` (1 model, 20 probes)     | < 120s                                |
| `aidrift check` (full suite)             | < 180s                                |
| Manifest parsing                         | < 100ms                               |
| Snapshot storage (read/write)            | < 500ms                               |

### Optimization Strategies

- Concurrent assertion execution (configurable parallelism)
- Probe result caching with TTL
- Incremental eval: only re-run assertions affected by changed artifacts
- Streaming output: show results as they complete, not at the end

---

## PR Checklist

Before marking any PR as ready:

- [ ] Code compiles with no TypeScript errors
- [ ] All existing tests pass
- [ ] New code has tests (≥ 85% coverage for new code)
- [ ] No `any` types introduced
- [ ] API keys are not leaked in any new code path
- [ ] Error messages follow the 4-part format (what/why/how/docs)
- [ ] stderr/stdout separation is correct
- [ ] CLI help text updated for new/changed commands
- [ ] No console.log — use the structured logger
- [ ] Debug output redacts sensitive data

---

## Definition of Done (MVP Launch)

1. `aidrift init → snapshot → plan → check` flow works end-to-end
2. GitHub Action published and works in a real CI pipeline
3. Documentation covers: quickstart, manifest reference, assertion reference, CI guide
4. 3 example projects demonstrate common use cases
5. npm package published and installable globally
6. README with badges, demo GIF, clear value proposition
7. LICENSE (Apache 2.0) and CONTRIBUTING.md in place
8. At least 10 beta users have tried the tool
9. Launch blog post written

---

## Sprint Priorities (Critical Path)

MVP launch-blocking: `init → snapshot → diff → plan → check → GitHub Action`

Can defer to v0.2: plugin system, Promptfoo compatibility layer

Sprint order:

1. Scaffold & Manifest (Weeks 1–2)
2. Init, Snapshot, History (Weeks 3–4)
3. Diff & Providers (Weeks 5–6)
4. Assertions & Eval (Weeks 7–8)
5. Plan, Probes, Statistics (Weeks 9–10)
6. CI/CD & Check (Weeks 11–12)
7. Plugins, Docs, Launch (Weeks 13–14)
