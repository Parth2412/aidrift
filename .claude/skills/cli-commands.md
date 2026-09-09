# CLI Commands — Current Contract

## When to Read This

Read before adding or modifying a command, option, output format, exit code, or Commander registration.

## Source Of Truth

`packages/cli/src/program.ts` and each file in `packages/cli/src/commands/` define the executable contract. `docs/reference/cli.md` is generated from that registration; never maintain a duplicate option catalog here.

Run after a command change:

```bash
pnpm docs:generate
pnpm docs:check
pnpm --filter @zettacore/aidrift typecheck
pnpm --filter @zettacore/aidrift test
```

## Shipped Commands

| Command            | Responsibility                                                     |
| ------------------ | ------------------------------------------------------------------ |
| `aidrift init`     | Safely scaffold a manifest, starter assertion, and project files   |
| `aidrift validate` | Parse, schema-check, resolve, and report manifest issues           |
| `aidrift snapshot` | Capture immutable artifact state and optional eval/probe baselines |
| `aidrift history`  | List validated local snapshots                                     |
| `aidrift diff`     | Compare current state or two snapshots                             |
| `aidrift plan`     | Execute the explicit eval target and compare behavioral samples    |
| `aidrift probe`    | Execute canonical provider probes and compare baseline evidence    |
| `aidrift check`    | Run the bounded non-interactive CI gate                            |

No `rollback`, `export`, `import`, `watch`, plugin, dashboard, or assertion-marketplace command is implemented. Do not document a drafted command as available.

## Global Behavior

- The supported configuration precedence is CLI option, AIDrift environment variable, manifest value, then default.
- Exit `0` means success/pass, exit `1` means validation or behavioral failure, and exit `2` means configuration/runtime failure.
- Redact secrets before writing operational errors.
- Preserve machine-readable stdout for JSON, JUnit, and GitHub formats; diagnostics go to stderr.
- Reject invalid selections, unsupported runtime features, missing credentials, and unsafe cost/timeout bounds before provider spend.
- Treat `--config` paths relative to the invocation context and artifact paths relative to the manifest.
- Keep non-interactive commands deterministic. `init` supports explicit overwrite control; no command may overwrite existing files by default.

## Change Checklist

- Register options in the executable Commander definition.
- Parse and bound numeric/list inputs centrally.
- Preserve exit-code and stdout/stderr contracts in tests.
- Add unit, fixture, and built-CLI coverage proportional to the change.
- Update generated CLI docs and any Action forwarding/input contract.
- Update schemas and migration notes when machine-readable output changes.
- Rebuild `packages/action/dist` when the bundled CLI changes.
