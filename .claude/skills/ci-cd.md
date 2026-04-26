# CI/CD — Quality Gates and Pipeline Integration

## When to Read This

Read before: working on `aidrift check`, building the GitHub Action, creating CI templates, implementing output formatters (JUnit, GitHub annotations), or working on PR comment generation.

---

## Check Command (`aidrift check`)

Same as `aidrift plan` but with CI-appropriate behavior:

- No interactive prompts
- No color codes if not a TTY
- Deterministic exit codes
- Machine-readable output options

### Exit Codes

| Code | Meaning                                                               | CI Result    |
| ---- | --------------------------------------------------------------------- | ------------ |
| `0`  | All assertions pass (or warn in non-strict mode)                      | Build passes |
| `1`  | Behavioral regression detected                                        | Build fails  |
| `2`  | Configuration error (missing manifest, invalid YAML, missing API key) | Build fails  |

### Check Modes

| Mode            | Flag                   | Behavior                                  |
| --------------- | ---------------------- | ----------------------------------------- |
| `strict`        | `--mode strict`        | Any regression OR warning fails           |
| `warn`          | `--mode warn`          | Only regressions fail; warnings pass      |
| `critical-only` | `--mode critical-only` | Only `critical: true` assertions can fail |

Default: `strict` (override via `AIDRIFT_CHECK_MODE`)

---

## Output Formatters

### Text (default)

Standard colored terminal output. Automatically disables colors when not a TTY.

### JSON (`--format json`)

```json
{
  "status": "fail",
  "assertions": [
    {
      "id": "safety_boundary",
      "status": "fail",
      "baseline_score": 1.0,
      "current_score": 0.8,
      "delta": -0.2,
      "p_value": 0.003,
      "details": "..."
    }
  ],
  "summary": {
    "passed": 4,
    "warned": 1,
    "failed": 1,
    "new": 1
  },
  "cost_usd": 0.23,
  "duration_ms": 42300
}
```

### JUnit XML (`--format junit`)

```xml
<testsuites name="aidrift" tests="6" failures="1">
  <testsuite name="my-ai-service" tests="6">
    <testcase name="greeting_tone" time="5.2">
    </testcase>
    <testcase name="safety_boundary" time="8.1">
      <failure message="Regression: 1.00 → 0.80 (-20.0%)">
        Safety response rate dropped below threshold.
      </failure>
    </testcase>
  </testsuite>
</testsuites>
```

Compatible with: Jenkins, CircleCI, Azure DevOps, GitHub Actions JUnit parsers.

### GitHub Annotations (`--format github-annotations`)

```
::error file=prompts/system.md,line=3::AIDrift: safety_boundary regression (1.00 → 0.80)
::warning file=prompts/system.md,line=3::AIDrift: tool_usage degraded (0.88 → 0.80)
```

Inline annotations appear on changed files in PR review.

---

## GitHub Action (`packages/action/`)

### action.yml Inputs

| Input                | Required | Default  | Description                      |
| -------------------- | -------- | -------- | -------------------------------- |
| `openai_api_key`     | No       | —        | OpenAI API key (from secrets)    |
| `anthropic_api_key`  | No       | —        | Anthropic API key (from secrets) |
| `check_mode`         | No       | `strict` | Check mode                       |
| `probe_providers`    | No       | `false`  | Run provider drift probes        |
| `comment_on_pr`      | No       | `true`   | Post results as PR comment       |
| `fail_on_regression` | No       | `true`   | Block merge on regression        |
| `annotations`        | No       | `true`   | Inline code annotations          |
| `samples`            | No       | `5`      | Samples per assertion            |
| `timeout`            | No       | `300`    | Max execution time (seconds)     |

### Workflow Template

```yaml
name: AI Behavioral Check
on:
  pull_request:
    paths:
      - "prompts/**"
      - "tools/**"
      - "rag/**"
      - "safety/**"
      - ".aistate.yml"

jobs:
  behavioral-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aidrift/action@v1
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          check_mode: strict
          comment_on_pr: true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: aidrift-results
          path: .aidrift/results/
```

### PR Comment Format

Markdown table with assertion results, overall status, provider drift status, and link to full report artifact.

### Comment Update Logic

- Uses a hidden HTML comment marker to identify AIDrift comments
- On subsequent pushes: UPDATES the existing comment (not duplicate)
- If no existing comment: creates a new one

### Snapshot Caching

- Uses `actions/cache` to cache `.aidrift/snapshots/` between runs
- Cache key: `aidrift-snapshots-${{ hashFiles('.aistate.yml') }}`
- Speeds up subsequent runs by avoiding re-computation of unchanged baselines

---

## GitLab CI Template

```yaml
aidrift-check:
  image: node:22-slim
  stage: test
  script:
    - npm install -g aidrift
    - aidrift check --format junit > aidrift-results.xml
  artifacts:
    reports:
      junit: aidrift-results.xml
  only:
    changes:
      - prompts/**
      - tools/**
      - .aistate.yml
```

---

## Generic CI Script

`aidrift-ci.sh` — works with any CI system:

```bash
#!/bin/bash
set -e
npm install -g aidrift
aidrift check --format json > aidrift-results.json
EXIT_CODE=$?
# Parse JSON for custom reporting
exit $EXIT_CODE
```

---

## Rules

- Check command MUST be non-interactive — no `inquirer` prompts in CI
- Exit code contract is sacred: 0 = pass, 1 = regression, 2 = config error
- Color output must auto-detect TTY — never send ANSI codes to CI logs unless it's a TTY
- JUnit XML must validate against the JUnit schema — test with real CI parsers
- PR comments must update (not duplicate) — use a hidden marker comment for identification
- API keys in CI come from secrets/env vars — the action MUST NOT log them
- `--timeout` must be enforced — CI runners have time limits
- Snapshot cache invalidation: re-cache when `.aistate.yml` hash changes
- The GitHub Action must work with `pull_request`, `push`, and `schedule` triggers
