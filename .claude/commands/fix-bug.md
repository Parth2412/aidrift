# Fix Bug

When given a bug report or error:

1. Reproduce the issue — find the exact input that triggers it
2. Read the relevant error logs and stack trace
3. Trace to root cause — don't just patch the symptom
4. Check if the root cause affects other code paths
5. Write a failing test that captures the bug
6. Fix the root cause
7. Verify the test passes
8. Run the full test suite to check for regressions
9. Update `tasks/lessons.md` if this was a class of bug we should prevent

If the bug involves:

- **Manifest parsing** → read `.claude/skills/manifest.md` first
- **Snapshot/diff** → read `.claude/skills/snapshot-and-diff.md` first
- **Assertions/eval** → read `.claude/skills/assertions-and-eval.md` first
- **Provider errors** → read `.claude/skills/providers.md` first
- **CI/CD failures** → read `.claude/skills/ci-cd.md` first
- **Statistics** → read `.claude/skills/probes-and-statistics.md` first

Never push through a fix that feels wrong. If the fix requires changes across 3+ files, re-plan first.
