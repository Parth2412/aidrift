# AIDrift Check Action

This Node 24 JavaScript Action runs the exact AIDrift CLI bundled with the Action release. It executes `aidrift check` once, then derives GitHub annotations, JUnit XML, an immutable workflow artifact, outputs, and an optional pull-request comment from the same JSON evidence. It never downloads an unpinned CLI at runtime and never repeats billable provider calls to produce another format.

The checked-in bundle includes generated dependency licenses in `dist/licenses.txt` and the supplemental notice in `dist/THIRD_PARTY_NOTICES.md`; the source notice is maintained in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Usage

This reference is usable after the owner publishes the immutable `v0.9.0-beta.1` repository tag. Before publication, repository development validates the checked-in bundle with `pnpm test:built-action`.

```yaml
name: AIDRIFT

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  behavioral-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: Parth2412/aidrift/packages/action@v0.9.0-beta.1
        with:
          manifest: .aistate.yml
          fail-on: fail
          samples: "5"
          timeout: "120"
          comment-mode: upsert
          github-token: ${{ github.token }}
```

For a live OpenAI or Anthropic manifest, pass the provider credential through the environment and set `cost-budget`. A live check without a known and enforceable cost ceiling exits as a configuration error.

```yaml
- uses: Parth2412/aidrift/packages/action@v0.9.0-beta.1
  with:
    cost-budget: "0.25"
    github-token: ${{ github.token }}
  env:
    AIDRIFT_OPENAI_API_KEY: ${{ secrets.AIDRIFT_OPENAI_API_KEY }}
```

## Security Contract

- Use `pull_request`, not `pull_request_target`. The Action rejects `pull_request_target` because combining untrusted PR state with write credentials or secrets is unsafe.
- Fork PRs retain GitHub's read-only token and receive no secrets. The behavioral check may run when its manifest is offline-safe, but comment writes are skipped.
- `contents: read` is sufficient to run checks and upload same-run evidence. Add `pull-requests: write` only when `comment-mode` is `upsert` or `new`; `checks: write` is not required for workflow-command annotations.
- The token is registered as a masked secret and is used only for same-repository issue-comment APIs.
- An upsert edits only a marker-bearing comment owned by `github-actions[bot]`; it does not edit a user or third-party bot comment.
- Provider output is not placed in the PR comment. Findings use the CLI's already-redacted explanations.

## Inputs

The Action forwards `manifest`, `baseline`, `fail-on`, `assertions`, `tags`, `samples`, `probe-model`, `probe-category`, `concurrency`, `timeout`, and `cost-budget` to the bounded `aidrift check` contract.

Action-only controls are:

- `comment-mode`: `upsert` (default), `new`, or `none`.
- `github-token`: required only for same-repository PR comments.
- `upload-artifact`: `true` by default.
- `artifact-name`: `aidrift-results` by default; make it unique if the Action runs more than once in one job.
- `retention-days`: 1–90, default 7.

## Outputs

- `result`: `pass`, `warn`, `fail`, or `error`.
- `regressions`: eval failures plus provider drift/insufficient-evidence results.
- `artifact-id` and `artifact-url`: set when upload succeeds.

The process preserves CLI exit semantics: `0` pass, `1` behavioral gate failure, and `2` configuration/runtime failure.
