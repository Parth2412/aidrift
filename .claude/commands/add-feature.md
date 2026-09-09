# Add Feature

When implementing a new feature:

1. **Understand scope** — read the relevant user story from project-docs if available
2. **Read the skill** — load the relevant `.claude/skills/*.md` before writing code
3. **Plan in tasks/todo.md** — break into subtasks if 3+ steps
4. **Check interfaces** — ensure the feature fits existing interfaces (LLMProvider, AssertionEvaluator, StorageBackend, etc.)
5. **Implement** — follow the module structure in `.claude/skills/architecture.md`
6. **Write tests** — unit tests first, integration tests for CLI commands
7. **Update CLI help** — if adding flags or commands
8. **Verify** — run full test suite, check coverage ≥ 85% for new code

Feature checklist:

- [ ] Follows existing patterns in the codebase
- [ ] No `any` types
- [ ] Error messages have: what/why/how/docs
- [ ] stderr for errors, stdout for results
- [ ] API keys never in logs or snapshots
- [ ] Tests written and passing
- [ ] CLI help text updated if applicable

If the feature touches multiple engines (e.g., eval + providers + statistics), plan the interface boundaries FIRST before writing implementation code.
