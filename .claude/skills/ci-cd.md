# CI/CD — Quality Gates and Pipeline Integration

## When to Read This

Read before changing `aidrift check`, the GitHub Action, CI recipes, evidence formats, or PR comment generation.

## Check Command

`aidrift check` is the bounded, non-interactive CI gate. It resolves the selected snapshot baseline, reports current artifact state for context, runs the selected eval and provider-probe workload, and gates on behavioral evidence.

### Exit Codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | The configured behavioral gate passed                   |
| `1`  | A regression crossed the configured `--fail-on` policy  |
| `2`  | Configuration, input, budget, timeout, or runtime error |

The only gate thresholds are `--fail-on fail` (default) and `--fail-on warn`. There is no `--mode`, `critical-only`, or `AIDRIFT_CHECK_MODE` contract.

### Evidence Formats

- `--format text`: human-readable terminal result.
- `--format json`: check-output v3 evidence. Validate it with `packages/sdk/schemas/check-output.v3.json`.
- `--format junit`: JUnit evidence for CI test-report consumers.
- `--format github`: GitHub workflow-command annotations.
- `--output <path>`: writes the selected evidence without changing the exit contract.

The schema keeps artifact context, workload/time/cost bounds, target identity, sample counts, statistical evidence, and the final gate summary. Update the schema, validators, fixtures, Action parser, generated docs, and migration notes together when this contract changes.

## GitHub Action

`packages/action/action.yml` runs the checked-in Node 24 bundle. It invokes the bundled CLI once, then derives annotations, JSON/JUnit artifacts, outputs, and an optional pull-request comment from the same evidence.

Input groups:

- Check selection: `manifest`, `baseline`, `fail-on`, `assertions`, `tags`, `samples`, `probe-model`, `probe-category`.
- Bounds: `concurrency`, `timeout`, and mandatory `cost-budget` for live providers.
- Action behavior: `comment-mode`, `github-token`, `upload-artifact`, `artifact-name`, `retention-days`.

Outputs are `result`, `regressions`, `artifact-id`, and `artifact-url`. Provider keys are never Action inputs; supply only the required `AIDRIFT_OPENAI_API_KEY` or `AIDRIFT_ANTHROPIC_API_KEY` through the job environment.

### Workflow Template

```yaml
name: AI Behavioral Check

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  behavioral-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: Parth2412/aidrift/packages/action@v0.9.0-beta.1
        with:
          samples: "5"
          timeout: "120"
          comment-mode: upsert
          github-token: ${{ github.token }}
```

For a live-provider manifest, add the required provider credential through `env` and set an explicit `cost-budget`. Default CI must remain offline and credential-free.

### Security Contract

- Use `pull_request`, never `pull_request_target`; the Action rejects the latter.
- Fork pull requests receive no provider secrets. Comment writes are skipped for forks.
- `contents: read` is sufficient unless PR comments are enabled; comments add `pull-requests: write`.
- The token is masked and used only for same-repository issue-comment operations.
- Upsert mode edits only the marker-bearing comment owned by `github-actions[bot]`.
- Provider output is excluded from PR comments; explanations pass through redaction.
- The Action does not cache or create a baseline. The repository must deliberately supply versioned snapshot state appropriate for its workflow.
- Rebuild and commit `packages/action/dist` after Action source or bundled CLI changes. CI rejects a stale bundle.

## Other CI Systems

Install the exact prerelease and preserve exit status:

```bash
npm install --global @zettacore/aidrift@next
aidrift check --format junit --output aidrift-results.xml
```

Publish `aidrift-results.xml` with the CI system's normal JUnit artifact mechanism. Do not place provider credentials on the command line or print them while debugging.

## Rules

- `check` must remain non-interactive and preserve exit codes `0`/`1`/`2`.
- Reject unsupported formats and invalid bounds before any billable provider request.
- Enforce the total timeout and cost ceiling across the entire selected workload.
- Keep stdout machine-readable for JSON, JUnit, and GitHub formats.
- Validate JUnit XML and JSON evidence with real consumers and schemas.
- PR comments update only the Action's own marker-bearing bot comment.
- Never log credentials, raw private prompts, or raw provider output.
- Keep the bundled Action and its dependency-license notices reproducible.
