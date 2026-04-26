# CLI Commands — Full Reference

## When to Read This

Read before: implementing or modifying any CLI command, adding flags/options, changing output formats, or working on command routing in `src/commands/`.

---

## Global Options (Available on All Commands)

| Flag              | Short | Env Var                   | Default     | Description                                |
| ----------------- | ----- | ------------------------- | ----------- | ------------------------------------------ |
| `--config <path>` | `-c`  | `AIDRIFT_CONFIG`          | Auto-detect | Path to `.aistate.yml`                     |
| `--verbose`       | `-v`  | `AIDRIFT_LOG_LEVEL=info`  | —           | Verbose output                             |
| `--debug`         |       | `AIDRIFT_LOG_LEVEL=debug` | —           | Debug output (includes HTTP, redacts keys) |
| `--quiet`         | `-q`  | `AIDRIFT_LOG_LEVEL=error` | —           | Suppress non-error output                  |
| `--no-color`      |       | `NO_COLOR=1`              | —           | Disable colored output                     |
| `--format <fmt>`  | `-f`  | `AIDRIFT_FORMAT`          | `text`      | Output format: `text`, `json`, `yaml`      |
| `--version`       | `-V`  |                           |             | Print version                              |
| `--help`          | `-h`  |                           |             | Print help                                 |

Config resolution order: CLI flags → environment variables → manifest values → hardcoded defaults.

---

## Command Reference

### `aidrift init`

Initialize AIDrift in the current project.

```
aidrift init [options]
  --template <name>     Use a project template (openai-chat, anthropic-chat, rag-pipeline, multi-model, agent-framework, local-llm)
  --list-templates      List available templates
  --yes, -y             Accept auto-detected defaults without prompting
  --force               Overwrite existing .aistate.yml
  --no-gitignore        Don't modify .gitignore
```

**Creates:** `.aistate.yml` + `.aidrift/` directory + `.gitignore` entry
**Exit codes:** 0 (success), 1 (error), 2 (already initialized, no --force)
**Performance:** < 10 seconds
**Sprint:** 2

---

### `aidrift validate`

Validate the manifest file against JSON Schema.

```
aidrift validate [options]
  --fix                 Auto-fix common issues (path normalization, missing defaults)
  --strict              Fail on warnings too (e.g., unpinned model versions)
```

**Exit codes:** 0 (valid), 1 (invalid)
**Sprint:** 1

---

### `aidrift snapshot`

Capture a point-in-time snapshot of AI system state.

```
aidrift snapshot [options]
  --label <text>        Human-readable label
  --message, -m <text>  Description of what changed
  --with-probes         Include provider probe baselines (costs API calls)
  --with-evals          Include eval suite baselines (costs API calls)
  --tags <t1,t2>        Tags for filtering
```

**Creates:** `.aidrift/snapshots/snap_YYYYMMDD_HHMMSS.json`
**Performance:** < 5 seconds (excluding large binary hashing and API calls for probes/evals)
**Sprint:** 2

---

### `aidrift diff`

Show differences between snapshots.

```
aidrift diff [snapshot_a] [snapshot_b] [options]
  snapshot_a            First snapshot (default: latest)
  snapshot_b            Second snapshot (default: current state)
  --stat                Summary only (no content diff)
  --artifact <name>     Diff specific artifact only
  --format <fmt>        Output: text, json, markdown
```

**No API calls.** Pure local operation.
**Performance:** < 2 seconds
**Sprint:** 3

---

### `aidrift plan`

Preview behavioral impact of current changes. Runs full eval suite.

```
aidrift plan [options]
  --assertions <ids>    Run only specific assertions (comma-separated)
  --tags <tags>         Run assertions matching tags
  --samples <n>         Override samples per assertion (default: 5)
  --allow-regression <ids>  Mark specific assertions as intentionally regressed
  --budget <amount>     Maximum cost for eval run (e.g., "$0.50")
  --timeout <seconds>   Maximum execution time
  --dry-run             Show what would be tested (no API calls)
  --probe-providers     Include provider drift probes
  --format <fmt>        Output: text, json, markdown
  --save                Save results to .aidrift/results/
```

**Costs API calls.** Displays cost estimate before running.
**Performance:** < 60s for 5 assertions × 5 samples
**Sprint:** 5

---

### `aidrift check`

CI/CD quality gate. Same as `plan` but CI-optimized.

```
aidrift check [options]
  --mode <mode>         Check mode: strict | warn | critical-only
  --probe-providers     Include provider drift probes
  --format <fmt>        Output: text, json, junit, github-annotations
  --assertions <ids>    Run only specific assertions
  --tags <tags>         Run assertions matching tags
  --samples <n>         Override samples per assertion
  --timeout <seconds>   Maximum execution time
  --fail-on-new         Also fail if new assertions have no baseline
```

**Exit codes:** 0 = pass, 1 = regression, 2 = config error
**Non-interactive.** No prompts. Auto-disables color when not TTY.
**Sprint:** 6

---

### `aidrift probe`

Detect provider-side model drift via canonical probe inputs.

```
aidrift probe [options]
  --model <name>        Probe specific model only
  --category <cat>      Probe category: deterministic, structural, semantic, behavioral, performance
  --include-custom      Include custom probes
  --exclude-builtin     Skip built-in probes
  --samples <n>         Samples per probe (default: 5)
  --cache-ttl <mins>    Cache TTL in minutes (default: 60)
  --no-cache            Disable caching
  --estimate-cost       Show estimated cost without running
```

**Costs API calls.** Cost estimation available via `--estimate-cost`.
**Performance:** < 120s for 1 model, 20 probes
**Sprint:** 5

---

### `aidrift history`

View snapshot history.

```
aidrift history [options]
  --limit <n>           Maximum entries (default: 20)
  --since <date>        After date (ISO 8601)
  --until <date>        Before date
  --show-changes        Include artifact change summary per snapshot
  --format <fmt>        Output: text, json
  --labels-only         Show only labeled snapshots
```

**No API calls.** Local operation.
**Sprint:** 2

---

### `aidrift rollback <snapshot_id>`

Restore artifact files to a prior snapshot.

```
aidrift rollback <snapshot_id> [options]
  --yes, -y             Skip confirmation prompt
  --dry-run             Show what would change without modifying files
  --artifacts <names>   Rollback only specific artifacts
```

**Creates a pre-rollback snapshot** before modifying files.
**Sprint:** 5 (or post-MVP)

---

### `aidrift export / import`

```
aidrift export <snapshot_id> [options]
  --output, -o <path>   Output file path
  --include-content     Include artifact file contents (not just hashes)
  --encrypt             Encrypt with passphrase

aidrift import <archive_path> [options]
  --decrypt             Decrypt with passphrase
```

---

### `aidrift plugin`

```
aidrift plugin install <package>
aidrift plugin remove <package>
aidrift plugin list
aidrift plugin update <package>
aidrift plugin create <name>
aidrift plugin dev <path>
```

**Sprint:** 7

---

### `aidrift config`

```
aidrift config show       # Show resolved config (manifest + env + defaults)
aidrift config edit       # Open manifest in $EDITOR
aidrift config path       # Print manifest file path
```

---

### `aidrift telemetry`

```
aidrift telemetry enable    # Opt in
aidrift telemetry disable   # Opt out
aidrift telemetry status    # Show what's collected
```

Telemetry is OFF by default. Collects: command used, artifact count, assertion count, execution time, error types. NEVER collects: file contents, API keys, outputs, prompts, project names.

---

## Environment Variables Reference

| Variable                     | Default            | Description                                 |
| ---------------------------- | ------------------ | ------------------------------------------- |
| `AIDRIFT_CONFIG`             | Auto-detect        | Path to `.aistate.yml`                      |
| `AIDRIFT_OPENAI_API_KEY`     | —                  | OpenAI API key                              |
| `AIDRIFT_ANTHROPIC_API_KEY`  | —                  | Anthropic API key                           |
| `AIDRIFT_GOOGLE_API_KEY`     | —                  | Google AI API key                           |
| `AIDRIFT_MISTRAL_API_KEY`    | —                  | Mistral API key                             |
| `AIDRIFT_COHERE_API_KEY`     | —                  | Cohere API key                              |
| `AIDRIFT_SAMPLES`            | `5`                | Default samples per assertion               |
| `AIDRIFT_SIGNIFICANCE_LEVEL` | `0.05`             | Statistical significance threshold          |
| `AIDRIFT_TIMEOUT`            | `300`              | Default timeout (seconds)                   |
| `AIDRIFT_CHECK_MODE`         | `strict`           | Default check mode                          |
| `AIDRIFT_LOG_LEVEL`          | `warn`             | Log level (error, warn, info, debug, trace) |
| `AIDRIFT_FORMAT`             | `text`             | Default output format                       |
| `AIDRIFT_CACHE_DIR`          | `~/.aidrift/cache` | Cache directory                             |
| `AIDRIFT_NO_TELEMETRY`       | `false`            | Disable telemetry                           |
| `HTTPS_PROXY`                | —                  | HTTP proxy for API calls                    |

---

## Rules

- Every command file goes in `src/commands/` — one file per command
- Use `commander` ^12.x for all command definitions
- Interactive prompts use `inquirer` — but ONLY in non-CI commands (init, rollback)
- `check` and `plan` must NEVER prompt — they are automation-friendly
- All commands respect `--format` for output (text, json, yaml, junit, github-annotations)
- Help text must be clear, concise, and include examples
- Commands that cost API calls must warn the user or support `--dry-run` / `--estimate-cost`
