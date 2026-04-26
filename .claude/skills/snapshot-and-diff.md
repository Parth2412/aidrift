# Snapshot & Diff — State Capture and Comparison

## When to Read This

Read before: working on `aidrift snapshot`, `aidrift diff`, `aidrift history`, `aidrift rollback`, `aidrift export/import`, or touching anything in `src/snapshot/` or `src/diff/`.

---

## Snapshot Engine (`src/snapshot/`)

### Snapshot Flow

```
aidrift snapshot
    ├── Parse .aistate.yml
    ├── For each artifact group:
    │   ├── Resolve file paths / globs
    │   ├── Read file contents (text) or compute hash (binary)
    │   ├── Compute SHA-256 hash
    │   └── Store content + hash in snapshot
    ├── Capture metadata (git commit, branch, dirty state, timestamp, CLI version, node version, OS)
    ├── Run probes and store baseline outputs (if --with-probes)
    ├── Run eval suite and store baselines (if --with-evals)
    ├── Write snapshot JSON to storage backend
    └── Print summary
```

### Snapshot JSON Structure

```json
{
  "schema_version": "1",
  "id": "snap_YYYYMMDD_HHMMSS",
  "label": "optional-human-label",
  "message": "optional description",
  "tags": ["optional", "tags"],
  "timestamp": "ISO 8601",
  "manifest_hash": "sha256:...",
  "artifacts": {
    "prompts/system_prompt": {
      "type": "prompt",
      "path": "./prompts/system.md",
      "hash": "sha256:...",
      "size_bytes": 2048,
      "content": "full text content for text artifacts",
      "last_modified": "ISO 8601"
    },
    "models/primary": {
      "type": "model",
      "provider": "openai",
      "model": "gpt-4o-2024-08-06",
      "parameters": { "temperature": 0.2, "max_tokens": 4096 },
      "hash": "sha256:model_params_hash"
    }
  },
  "probe_baselines": {
    "openai/gpt-4o-2024-08-06": {
      "deterministic_math": { "output": "2", "hash": "sha256:..." }
    }
  },
  "eval_baselines": {
    "greeting_tone": { "score": 0.92, "samples": 5, "std_dev": 0.04 }
  },
  "metadata": {
    "git_commit": "abc1234",
    "git_branch": "main",
    "git_dirty": false,
    "cli_version": "0.2.0",
    "node_version": "22.0.0",
    "os": "linux-x64"
  }
}
```

### Storage Rules

- Text artifacts: store FULL CONTENT (enables content diffing)
- Binary artifacts: store HASH ONLY (not the file content)
- Snapshots stored in `.aidrift/snapshots/` as individual JSON files
- Snapshot ID format: `snap_YYYYMMDD_HHMMSS` (unique by timestamp)
- `.aidrift/snapshots/` is gitignored (may contain prompt content = sensitive)
- Performance target: < 5 seconds for typical project (excluding large binary hashing)

### Storage Backends

- `local` (default): JSON files on filesystem in `.aidrift/snapshots/`
- `git`: Git-based storage (snapshots tracked in a separate git branch or submodule)
- Future: S3, GCS, Azure Blob (Phase 4 — team collaboration)

---

## Diff Engine (`src/diff/`)

### Four Diff Types

| Type                    | File            | Handles                          | Output                                               |
| ----------------------- | --------------- | -------------------------------- | ---------------------------------------------------- |
| Text diff               | `text.ts`       | Prompt files, config files       | Unified diff with line-level changes                 |
| JSON/YAML semantic diff | `json.ts`       | Structured configs, tool schemas | Key-value changes (added/removed/modified keys)      |
| Binary diff             | `binary.ts`     | Model weights, indices           | Hash comparison (changed/unchanged)                  |
| Parameter diff          | `parameters.ts` | Model parameters                 | Field-level changes (e.g., `temperature: 0.2 → 0.4`) |

### Diff Flow

```
aidrift diff [snap_a] [snap_b]
    ├── Resolve snapshots (default: latest vs current state)
    ├── If comparing to current: hash all current artifacts
    ├── For each artifact:
    │   ├── Compare hashes (quick check)
    │   ├── If changed, run appropriate diff type
    │   └── Collect change details
    ├── Format output (terminal | json | markdown)
    └── Print
```

### Output Formatters (`src/diff/formatter/`)

| Format   | File          | Use Case                                                       |
| -------- | ------------- | -------------------------------------------------------------- |
| Terminal | `terminal.ts` | Human-readable, colored (green add, red delete, yellow modify) |
| JSON     | `json.ts`     | Machine-readable for scripting                                 |
| Markdown | `markdown.ts` | PR comments                                                    |

---

## History Command

- Lists all snapshots in reverse chronological order
- Fields: snapshot ID, label, timestamp, # changed artifacts, git commit
- Flags: `--limit`, `--since`, `--until`, `--show-changes`, `--format`, `--labels-only`

## Rollback Command

- Restores TEXT artifacts to their state in target snapshot
- Does NOT modify model provider settings (only local files)
- Creates a pre-rollback snapshot labeled `rollback-to-<snapshot_id>` before modifying files
- Shows preview of changes before executing (requires confirmation or `--yes`)
- Warns if git state has uncommitted changes
- `--artifacts <names>` for partial rollback

## Export / Import

- `aidrift export <snap_id>` → creates `.aistate.tar.gz` archive
- Archive includes: manifest, text artifact contents, hashes, eval results
- Archive does NOT include binary artifacts (only hashes)
- `--encrypt` encrypts with AES-256 passphrase
- `aidrift import <archive>` restores snapshot in another environment

---

## Rules

- Always use SHA-256 for hashing (via `src/snapshot/hasher.ts`)
- Never store API keys in snapshots
- Snapshot JSON must be valid against the snapshot schema (versioned via `schema_version`)
- Diff operations are always local — never make API calls during diff
- `aidrift diff` default behavior: current state vs. latest snapshot
- Snapshot performance target: < 5s for typical projects
- Diff performance target: < 2s (local operation only)
