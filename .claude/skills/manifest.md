# Manifest — `.aistate.yml` Contract

## When to Read This

Read before changing the manifest schema/types, validation, path resolution, templates, runtime-support boundary, or `init`/`validate` behavior.

## Sources Of Truth

- Executable schema: `packages/core/src/manifest/schema.ts`
- TypeScript types: `packages/core/src/manifest/types.ts`
- Parser and semantic checks: `packages/core/src/manifest/parser.ts`
- File/assertion resolution: `packages/core/src/manifest/resolver.ts`
- Runtime subset: `packages/core/src/manifest/runtime-support.ts`
- Generated reference: `docs/reference/manifest.md`
- Packaged schema: `packages/sdk/schemas/aistate.v1.schema.json`

Run `pnpm docs:generate` after schema changes. CI runs `pnpm docs:check` and rejects stale generated artifacts.

## Validation Layers

1. Bounded UTF-8 read and YAML parse.
2. JSON Schema conformance, including unknown-field rejection where specified.
3. Semantic checks such as unique artifact keys and secret-like manifest values.
4. Project-boundary path/glob resolution with `.gitignore` awareness and cardinality limits.
5. Assertion-suite parsing and issue aggregation.
6. Command-specific runtime-support validation before capture or behavioral execution.

All artifact paths are relative to the manifest directory. Errors may describe the resolved path for diagnosis, but machine evidence and public feedback must not leak private paths unnecessarily.

## Schema Versus Runtime Support

The version-1 schema reserves capabilities beyond the beta runtime. Schema-valid does not mean executable.

Current runtime constraints include:

- snapshot storage backend must be `local`;
- plugins are not loaded;
- custom artifacts and RAG index hash commands are not executed;
- adapter hashing is SHA-256 only;
- behavioral execution requires an explicit `provider` eval target;
- provider targets apply declared text prompts and supported model parameters;
- RAG, tool, safety, and adapter artifacts are not applied to provider requests;
- prompt formats other than text are not rendered for provider execution;
- Promptfoo, HTTP, subprocess, custom, and other reserved target paths are unavailable.

Unsupported behavior must fail with exit `2`; never drop it silently or substitute mock execution.

## Initialization

`aidrift init` scans bounded project paths and can create a starter manifest/assertion flow. Built-in templates are `basic-llm`, `rag-pipeline`, and `agent`. The latter two may contain snapshot-compatible artifacts whose behavioral execution remains intentionally unsupported.

Initialization rules:

- do not overwrite existing files by default;
- make non-force creation race-safe;
- use atomic replacement for explicit force writes;
- add `.aidrift/` to `.gitignore` without destroying existing content;
- make `--dry-run` side-effect free;
- keep `--yes` deterministic and non-interactive.

## Security And Compatibility Rules

- Never allow credentials or tokens in the manifest; providers read environment variables only.
- Bound document depth, keys, strings, arrays, files, globs, and assertions before materializing untrusted input.
- Keep `.aistate.yml` version-controlled; keep `.aidrift/` ignored by default.
- Treat schema changes as public API changes and update types, generated docs/schema, templates, fixtures, SDK contracts, and migration notes together.
- Preserve version-1 compatibility unless the release explicitly declares and tests a migration.
