# Plugins — Extensibility System

## When to Read This

Read before: building or modifying the plugin system, creating first-party plugins, implementing the plugin SDK, or working on anything in `src/plugins/` or `packages/sdk/`.

---

## Plugin Types

| Type                | Interface            | Purpose                             | Example                       |
| ------------------- | -------------------- | ----------------------------------- | ----------------------------- |
| Artifact Resolver   | `ArtifactResolver`   | Hash and diff custom artifact types | Pinecone index tracker        |
| Assertion Evaluator | `AssertionEvaluator` | Custom assertion logic              | Medical accuracy scorer       |
| Output Formatter    | `OutputFormatter`    | Custom output formats               | Slack message, Datadog metric |
| Storage Backend     | `StorageBackend`     | Custom snapshot storage             | S3, GCS, Azure Blob           |

---

## Plugin SDK (`packages/sdk/`)

Published as `@aidrift/sdk` on npm.

### Core Interfaces

```typescript
// ArtifactResolver — how to hash and diff a custom artifact type
interface ArtifactResolver {
  type: string; // e.g., 'rag_index'
  provider: string; // e.g., 'pinecone'

  hash(config: ArtifactConfig): Promise<string>;
  diff(baseline: string, current: string): Promise<DiffResult>;
}

// AssertionEvaluator — custom assertion type
interface AssertionEvaluator {
  type: string;

  evaluate(
    input: string,
    output: AISystemOutput,
    config: AssertionConfig,
  ): Promise<AssertionResult>;
}

// StorageBackend — where snapshots are stored
interface StorageBackend {
  save(snapshot: Snapshot): Promise<void>;
  load(id: string): Promise<Snapshot>;
  list(options: ListOptions): Promise<SnapshotMeta[]>;
  delete(id: string): Promise<void>;
}

// OutputFormatter — custom output format
interface OutputFormatter {
  format: string; // e.g., 'slack', 'datadog'
  formatPlan(result: PlanResult): string;
  formatCheck(result: CheckResult): string;
  formatProbe(result: ProbeResult): string;
}

// Plugin entry point
interface AIDriftPlugin {
  name: string;
  version: string;
  resolvers?: ArtifactResolver[];
  evaluators?: AssertionEvaluator[];
  formatters?: OutputFormatter[];
  storage?: StorageBackend[];
}
```

---

## Plugin Loader (`src/plugins/loader.ts`)

### Discovery

1. Read `plugins` array from `.aistate.yml`
2. Check `node_modules` for packages matching `@aidrift/plugin-*` or `aidrift-plugin-*`
3. Load each plugin's default export
4. Validate plugin implements `AIDriftPlugin` interface
5. Register resolvers/evaluators/formatters/storage with the plugin registry

### Loading Order

1. Built-in plugins (part of core)
2. First-party plugins (`@aidrift/plugin-*`)
3. Community plugins (`aidrift-plugin-*`)
4. Local dev plugins (`aidrift plugin dev ./path`)

### Plugin Lifecycle

```
CLI startup
    ├── Parse manifest
    ├── Discover plugins
    ├── For each plugin:
    │   ├── require() or import() the package
    │   ├── Validate interface compliance
    │   ├── Register capabilities with plugin registry
    │   └── Log plugin load at info level
    └── Continue with command execution
```

---

## Plugin Commands

| Command                            | Purpose                                         |
| ---------------------------------- | ----------------------------------------------- |
| `aidrift plugin install <package>` | Install from npm/PyPI                           |
| `aidrift plugin remove <package>`  | Remove a plugin                                 |
| `aidrift plugin list`              | List installed plugins with versions and status |
| `aidrift plugin update <package>`  | Update to latest                                |
| `aidrift plugin create <name>`     | Scaffold new plugin from template               |
| `aidrift plugin dev <path>`        | Load local plugin for development               |

---

## First-Party Plugins

| Plugin   | Package                    | Artifact Type              | Phase    |
| -------- | -------------------------- | -------------------------- | -------- |
| Pinecone | `@aidrift/plugin-pinecone` | `rag_index` (vector store) | Sprint 7 |
| Weaviate | `@aidrift/plugin-weaviate` | `rag_index` (vector store) | Sprint 7 |
| ChromaDB | `@aidrift/plugin-chromadb` | `rag_index` (vector store) | Sprint 7 |

---

## Plugin Scaffold Template

`aidrift plugin create my-plugin` generates:

```
aidrift-plugin-my-plugin/
├── src/
│   └── index.ts           # Default export implementing AIDriftPlugin
├── tests/
│   └── index.test.ts      # Test fixtures
├── package.json            # Correct peerDependencies on @aidrift/sdk
├── tsconfig.json
└── README.md
```

---

## Plugin Security (v1)

- Plugins execute in the SAME process (no sandboxing)
- Users are warned when installing unverified plugins
- Plugin registry will require signed packages (Phase 4)
- The plugin SDK is versioned with semver — breaking changes require major version bump

---

## Promptfoo Compatibility Layer

Special plugin/adapter that imports Promptfoo config:

```yaml
eval:
  format: promptfoo
  import:
    - source: promptfoo
      path: ./promptfooconfig.yaml
      map_assertions: true
```

- Parses Promptfoo YAML format
- Maps Promptfoo assertion types to AIDrift assertion types
- `aidrift import promptfoo` migration command converts configs

---

## Rules

- Plugin SDK is a SEPARATE package (`packages/sdk/`) — it must not depend on CLI internals
- Plugins must declare `@aidrift/sdk` as a `peerDependency`, not a direct dependency
- Plugin interface compliance is validated at load time — fail loudly if interface not met
- First-party plugins live in `plugins/` directory of the monorepo
- Community plugins are npm packages — no custom registry
- Plugin API is versioned — any breaking change to SDK interfaces bumps SDK major version
- Plugins must not modify global state — register capabilities through the plugin registry only
