# Manifest — .aistate.yml Specification & Parsing

## When to Read This

Read before: modifying the manifest schema, adding artifact types, working on `aidrift validate`, working on `aidrift init`, creating templates, or touching anything in `src/manifest/`.

---

## .aistate.yml Structure

```yaml
version: "1" # Schema version (required)
name: "my-ai-service" # Project name (required)
description: "..." # Optional description

artifacts: # All artifacts that compose AI behavioral state
  prompts: # Prompt files
    <name>:
      type: prompt
      path: ./prompts/system.md # Relative path from manifest
      format: text | json | jinja2 | mustache

  models: # Model configurations
    <name>:
      type: model
      provider: openai | anthropic | google | mistral | cohere | local | custom
      model: gpt-4o-2024-08-06 # Specific model ID
      parameters:
        temperature: 0.2
        max_tokens: 4096
        top_p: 1.0

  rag: # RAG configurations
    <name>:
      type: rag_config
      path: ./rag/config.yml
      index_hash_command: "md5sum ./rag/index.bin" # Optional command to hash index

  tools: # Tool/function schemas
    <name>:
      type: tool_schema
      path: ./tools/schemas/
      glob: "*.json" # File pattern matching

  safety: # Safety rules and guardrails
    <name>:
      type: safety_rules
      path: ./safety/rules.yml

  adapters: # Model adapters (LoRA, etc.)
    <name>:
      type: adapter
      path: ./adapters/lora_v3.bin
      hash_algorithm: sha256

  custom: # User-defined artifact types
    <name>:
      type: custom
      path: ./custom/
      metadata: {}

eval: # Evaluation configuration
  suite: ./evals/ # Directory containing assertion YAML files
  format: aidrift | promptfoo # Assertion format
  samples_per_assertion: 5 # Default samples per assertion
  significance_level: 0.05 # Statistical significance threshold
  timeout_seconds: 30 # Per-assertion timeout
  target: # How to interact with the AI system
    type: provider | http | subprocess
    # provider: uses model config directly
    # http: { url, method, headers, body_template, response_path }
    # subprocess: { command, input_format, output_format }

storage: # Snapshot storage config
  backend: local | git
  path: .aidrift/snapshots/

plugins: [] # Optional plugin references
```

---

## JSON Schema Validation

- Schema lives at `src/manifest/schema.json`
- Validated with `ajv` ^8.x at parse time
- Validation checks:
  1. YAML syntax (via `yaml` parser)
  2. Schema conformance (required fields, types, enums)
  3. File path existence (all `path` fields resolve to real files)
  4. Glob patterns resolve to at least one file
  5. Provider names are recognized
  6. Referenced assertion files exist and parse
  7. Plugin names are installed

---

## TypeScript Interfaces

Core types in `src/manifest/types.ts`:

```typescript
interface AIStateManifest {
  version: string;
  name: string;
  description?: string;
  artifacts: ArtifactGroups;
  eval: EvalConfig;
  storage: StorageConfig;
  plugins?: PluginConfig[];
}

interface ArtifactGroups {
  prompts?: Record<string, PromptArtifact>;
  models?: Record<string, ModelArtifact>;
  rag?: Record<string, RAGArtifact>;
  tools?: Record<string, ToolArtifact>;
  safety?: Record<string, SafetyArtifact>;
  adapters?: Record<string, AdapterArtifact>;
  custom?: Record<string, CustomArtifact>;
}

interface ArtifactBase {
  type: string;
  path?: string;
  glob?: string;
  hash_algorithm?: "sha256" | "md5";
  metadata?: Record<string, unknown>;
}
```

---

## File Path Resolution

- All paths are relative to the manifest file location
- Glob patterns use `glob` ^10.x
- Resolution respects `.gitignore` patterns
- `src/manifest/resolver.ts` handles: relative paths, glob expansion, existence checks, `.gitignore` filtering
- Non-existent paths → validation error with helpful message including the resolved absolute path

---

## Auto-Detection (aidrift init)

The project scanner in `src/commands/init.ts` detects:

| Artifact Type | Detection Strategy                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Prompts       | Scan `prompts/`, `templates/`, `system_prompts/` for `.md`, `.txt`, `.jinja2`, `.j2`, `.mustache`                               |
| Model SDKs    | Parse `package.json` for `openai`, `@anthropic-ai/sdk`, `cohere-ai`; `requirements.txt`/`pyproject.toml` for Python equivalents |
| Tool schemas  | JSON files in `tools/`, `functions/`, `schemas/` directories                                                                    |
| RAG configs   | Known patterns: `chromadb`, `pinecone`, `weaviate` config files                                                                 |
| Safety rules  | Files in `safety/`, `guardrails/`, `rules/` directories                                                                         |

- Recursive scan but respects `.gitignore`
- Results presented to user for confirmation (via `inquirer`)
- `--yes` flag skips prompts, uses auto-detected defaults
- Handles no-artifact projects gracefully (prompts manual config)

---

## Templates

Built-in templates in `src/manifest/templates/`:

| Template          | Use Case                  |
| ----------------- | ------------------------- |
| `openai-chat`     | Simple OpenAI chatbot     |
| `anthropic-chat`  | Anthropic-based system    |
| `rag-pipeline`    | RAG with vector store     |
| `multi-model`     | Primary + fallback models |
| `agent-framework` | Multi-agent system        |
| `local-llm`       | Ollama/vLLM local models  |

Each template includes: manifest YAML + sample assertion files + explanatory comments.

---

## Rules

- `.aistate.yml` is NOT gitignored — it's part of the project
- `.aidrift/` IS gitignored (auto-configured by `aidrift init`)
- Manifest must be valid YAML that passes schema validation before any command runs
- `aidrift validate --fix` can auto-fix: path normalization, add missing required fields with defaults
- `aidrift validate --strict` treats warnings as errors (e.g., unpinned model versions like `gpt-4o` instead of `gpt-4o-2024-08-06`)
- Never store API keys in the manifest — always environment variables
