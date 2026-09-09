# Sprint Work

When starting work on a sprint task:

1. **Identify the sprint** — check `tasks/todo.md` for current sprint
2. **Read the implementation plan** — `project-docs/06_ENGINEERING_IMPLEMENTATION_PLAN.md` has task breakdowns with hour estimates
3. **Read relevant skills** — load `.claude/skills/*.md` for the domain area
4. **Read relevant user stories** — `project-docs/03_USER_STORIES.md` has acceptance criteria

## Sprint → Skill Mapping

| Sprint                 | Focus                    | Skills to Read                                                          |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------- |
| Sprint 1 (Weeks 1–2)   | Scaffold & Manifest      | `architecture.md`, `manifest.md`, `cli-commands.md`                     |
| Sprint 2 (Weeks 3–4)   | Init, Snapshot, History  | `manifest.md`, `snapshot-and-diff.md`, `cli-commands.md`                |
| Sprint 3 (Weeks 5–6)   | Diff & Providers         | `snapshot-and-diff.md`, `providers.md`                                  |
| Sprint 4 (Weeks 7–8)   | Assertions & Eval        | `assertions-and-eval.md`, `providers.md`                                |
| Sprint 5 (Weeks 9–10)  | Plan, Probes, Statistics | `probes-and-statistics.md`, `assertions-and-eval.md`, `cli-commands.md` |
| Sprint 6 (Weeks 11–12) | CI/CD & Check            | `ci-cd.md`, `cli-commands.md`                                           |
| Sprint 7 (Weeks 13–14) | Plugins, Docs, Launch    | `plugins.md`, `code-review.md`                                          |

## Workflow

1. Pick the next task from `tasks/todo.md`
2. Write implementation plan (if 3+ steps)
3. Implement with tests
4. Mark complete in `tasks/todo.md`
5. Move to next task

## Definition of Done (Per Task)

- Code compiles, tests pass
- Coverage ≥ 85% for new code
- CLI help text updated if applicable
- No security violations (check `.claude/skills/code-review.md`)
