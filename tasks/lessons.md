# AIDrift — Lessons Learned

Format: `[date] | severity | what went wrong | rule to prevent it`

## Lessons

<!-- Claude fills this in over time. Example entries:

| Date | Severity | What Went Wrong | Rule |
|------|----------|----------------|------|
| 2026-04-15 | HIGH | Pushed snapshot with API key in test fixture | Always grep for key patterns (sk-, key-) before committing test fixtures |
| 2026-04-16 | MED | Console.log left in production code | Use structured logger only; lint rule to catch console.log |
| 2026-04-17 | LOW | Forgot to update CLI help text after adding flag | Add help text update to PR checklist |

-->

| Date       | Severity | What Went Wrong                                                                                                                                                                                                                                                                               | Rule                                                                                                                                                                                                         |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —          | —        | No lessons yet                                                                                                                                                                                                                                                                                | Session start: review this file before touching code                                                                                                                                                         |
| 2026-05-02 | LOW      | Skill `.claude/skills/providers.md` prescribes the `openai` and `@anthropic-ai/sdk` packages for live adapters, but those would add heavy runtime dependencies and SDK-shaped mocks for tests. Implemented adapters with built-in `fetch` and an injectable `fetch` option for tests instead. | Live provider adapters in this repo go via raw `fetch` with dependency-injected `fetch` in tests. Skill docs describe an aspirational `LLMProvider` shape; the runner-facing contract is `EvalProvider`.     |
| 2026-05-02 | MED      | The `commit-msg` hook rejects vendor names (`OpenAI`, `Anthropic`, `Claude`, `Codex`) case-insensitively. Generated drafts that mention them get rejected and need rewording.                                                                                                                 | Conventional Commit subjects/bodies must avoid vendor brand names; describe by API surface (`chat-completions`, `messages-API`) and live in commit messages. Filenames and code identifiers are not checked. |
