# Architecture — AIDrift System Design

## When to Read This

Read before: adding new modules, changing directory structure, adding dependencies, creating new packages, or making architectural decisions.

---

## Monorepo Structure (Turborepo)

```
aidrift/
├── packages/
│   ├── cli/                     # Main CLI (@aidrift/cli) — entry point
│   │   ├── src/
│   │   │   ├── commands/        # CLI command implementations (one file per command)
│   │   │   ├── manifest/        # Manifest parsing & validation
│   │   │   │   ├── schema.json  # JSON Schema for .aistate.yml
│   │   │   │   ├── parser.ts    # YAML parsing + ajv validation
│   │   │   │   ├── resolver.ts  # File path resolver (globs, relative paths)
│   │   │   │   ├── types.ts     # TypeScript interfaces
│   │   │   │   └── templates/   # Built-in project templates (openai-chat, rag-pipeline, etc.)
│   │   │   ├── snapshot/        # Snapshot engine
│   │   │   │   ├── engine.ts    # Core snapshot logic
│   │   │   │   ├── hasher.ts    # SHA-256 hashing
│   │   │   │   ├── storage/     # Storage backends (local.ts, git.ts, interface.ts)
│   │   │   │   ├── comparator.ts
│   │   │   │   └── types.ts
│   │   │   ├── diff/            # Diff engine
│   │   │   │   ├── engine.ts    # Orchestrator across artifact types
│   │   │   │   ├── text.ts      # Unified diff for text
│   │   │   │   ├── json.ts      # Semantic diff for JSON/YAML
│   │   │   │   ├── binary.ts    # Hash comparison
│   │   │   │   ├── parameters.ts # Key-value parameter diff
│   │   │   │   ├── formatter/   # terminal.ts, json.ts, markdown.ts
│   │   │   │   └── types.ts
│   │   │   ├── eval/            # Eval runner & assertions
│   │   │   │   ├── runner.ts    # Orchestrates multi-sample execution
│   │   │   │   ├── parser.ts    # Assertion YAML parser
│   │   │   │   ├── assertions/  # One file per assertion type
│   │   │   │   │   ├── interface.ts, contains.ts, regex.ts, json-schema.ts
│   │   │   │   │   ├── llm-judge.ts, tool-call.ts, latency.ts
│   │   │   │   │   ├── cost.ts, semantic.ts, custom.ts
│   │   │   │   ├── executor.ts  # Sends inputs, captures outputs
│   │   │   │   ├── statistics.ts # Welch's t-test, Fisher's exact
│   │   │   │   └── types.ts
│   │   │   ├── probe/           # Provider drift probes
│   │   │   │   ├── runner.ts
│   │   │   │   ├── canonical/   # deterministic.ts, structural.ts, semantic.ts, behavioral.ts, performance.ts
│   │   │   │   ├── comparator.ts
│   │   │   │   ├── cache.ts
│   │   │   │   └── types.ts
│   │   │   ├── providers/       # LLM provider adapters
│   │   │   │   ├── interface.ts, openai.ts, anthropic.ts, google.ts
│   │   │   │   ├── mistral.ts, cohere.ts, local.ts, custom.ts
│   │   │   │   └── registry.ts
│   │   │   ├── plugins/         # Plugin system
│   │   │   │   ├── loader.ts, registry.ts
│   │   │   │   ├── sdk/         # Public SDK exports (artifact.ts, assertion.ts, storage.ts, formatter.ts)
│   │   │   │   └── scaffold/    # Plugin template generator
│   │   │   ├── output/          # Output formatters (terminal, json, junit, github-annotations)
│   │   │   └── utils/           # Shared utilities
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── sdk/                     # Plugin SDK (@aidrift/sdk) — published interfaces
│   ├── action/                  # GitHub Action (action.yml + Docker container)
│   └── python/                  # Python SDK wrapper (subprocess wraps CLI)
├── plugins/                     # First-party plugins (pinecone, weaviate, chromadb)
├── examples/                    # Example projects (openai-chatbot, rag-pipeline, multi-agent, local-llm)
├── docs/                        # VitePress or Docusaurus documentation site
├── .github/workflows/           # CI (lint, test, build)
├── turbo.json                   # Turborepo config
├── LICENSE                      # Apache 2.0
└── README.md
```

---

## Core Dependency Map

| Dependency          | Purpose                | Version | Notes                                             |
| ------------------- | ---------------------- | ------- | ------------------------------------------------- |
| `commander`         | CLI framework          | ^12.x   | One command per file in `src/commands/`           |
| `inquirer`          | Interactive prompts    | ^9.x    | Used in `init`, `rollback`                        |
| `chalk`             | Terminal colors        | ^5.x    | ESM only — use dynamic import or v4 if CJS needed |
| `yaml`              | YAML parsing           | ^2.x    | For `.aistate.yml` and assertion YAML             |
| `ajv`               | JSON Schema validation | ^8.x    | Validates manifest against `schema.json`          |
| `diff`              | Text diffing           | ^5.x    | Unified diff for prompts/configs                  |
| `ora`               | Spinners               | ^8.x    | Async operation feedback                          |
| `glob`              | File pattern matching  | ^10.x   | Artifact file resolution                          |
| `chokidar`          | File watching          | ^3.x    | Watch mode (Phase 4)                              |
| `openai`            | OpenAI API client      | ^4.x    | Provider adapter                                  |
| `@anthropic-ai/sdk` | Anthropic API client   | ^0.x    | Provider adapter                                  |
| `cosine-similarity` | Semantic comparison    | ^1.x    | Probe comparator                                  |
| `simple-statistics` | Statistical tests      | ^7.x    | Welch's t-test, distributions                     |

---

## Design Principles (Architectural)

1. **Unix philosophy** — each module does one thing well, composes via interfaces
2. **CLI-first** — every feature works from the terminal; SDK/API wrap the CLI
3. **Local-first** — full functionality offline; no cloud dependency for core
4. **Plugin boundary** — plugins extend via interfaces (ArtifactResolver, AssertionEvaluator, StorageBackend, OutputFormatter), never modify core
5. **Provider-agnostic** — uniform `LLMProvider` interface; never leak provider specifics into core
6. **Stateless CLI** — all state lives in `.aistate.yml` (manifest) + `.aidrift/` (snapshots); CLI is a pure function of inputs

---

## Key Data Flow

```
.aistate.yml (manifest) → Manifest Parser → Validated Config
                                               ↓
                                        Snapshot Engine → .aidrift/snapshots/*.json
                                               ↓
                                        Diff Engine → Change Detection
                                               ↓
                                  ┌─────────────┴──────────────┐
                                  ↓                            ↓
                           Eval Runner                   Probe Runner
                        (behavioral assertions)     (provider drift detection)
                                  ↓                            ↓
                           Statistics Engine ←─────────────────┘
                                  ↓
                        Plan / Check Output (pass/warn/fail)
```

---

## Rules

- New modules go under the appropriate engine directory — never create top-level `src/` files
- Every public interface gets a `types.ts` in its module directory
- Provider adapters MUST implement the `LLMProvider` interface from `src/providers/interface.ts`
- Assertion evaluators MUST implement `AssertionEvaluator` from `src/eval/assertions/interface.ts`
- All file I/O goes through utility functions in `src/utils/` — never raw `fs` calls in command files
- Config resolution order: CLI flags → environment variables → manifest values → defaults
