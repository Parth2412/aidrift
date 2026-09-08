# AIDrift Beta Program

## Release status

`0.9.0-beta.0` is a locally verified bootstrap release candidate. It is not an available npm or GitHub Action release until the protected owner publication steps succeed. Do not report an installation as successful unless it came from the public registry or a locally generated release tarball.

## Supported beta boundary

- Node.js 22.14.0 or newer; release production is pinned to Node 24.20.0.
- Linux, macOS, and Windows clean-install smoke coverage.
- Local artifact snapshots and semantic diffs.
- Deterministic mock, OpenAI Chat Completions, and Anthropic Messages targets.
- `contains`, `regex`, and `json_schema` assertions.
- Twenty built-in provider probes and the `check` GitHub quality gate.
- Local snapshot storage only.

## Known limitations

- This is prerelease software; CLI, TypeScript, evidence-schema, and manifest details can change before `1.0.0`.
- RAG, tool, safety-rule, adapter, custom target, custom assertion, and plugin execution fail closed because those runtime integrations are not implemented.
- `llm_judge`, `tool_call`, `latency`, `cost`, `semantic_stability`, and `custom` assertions are unsupported.
- Artifact changes are reported as context; sampled eval and provider evidence determine the check result.
- The offline mock provider proves workflow mechanics, not real model quality.
- Live-provider checks need credentials, make billable calls, and require an explicit cost ceiling. Pricing estimates are not invoices.
- Live-provider calls are not retried automatically. Run-level deadlines, response limits, and cost ceilings fail closed; retry an infrastructure failure deliberately after checking provider status and recorded spend.
- JSON Schema regexes use RE2 syntax; lookaround and backreferences are unsupported. Standalone regex assertions are screened for unsafe backtracking and have a 250 ms execution deadline.
- Inputs, project discovery, snapshots, provider output, workloads, and Action evidence are bounded. Runs that exceed the published [safety and resource limits](docs/reference/safety-limits.md) exit `2` instead of returning partial evidence.
- There is no PyPI package, cloud service, dashboard, telemetry, or automatic upload. State remains local unless the user deliberately uploads CI evidence.

## Report beta evidence

Use the **Beta feedback** GitHub issue form for completed runs, confusing output, missed regressions, and false positives. Use **Bug report** for a reproducible defect. Before posting, remove prompts, model outputs, credentials, customer data, filesystem paths, and proprietary configuration that should not be public.

Security vulnerabilities must not be filed as public issues. Follow [SECURITY.md](SECURITY.md), using GitHub private vulnerability reporting after the owner enables it.

Maintainers record aggregate outcomes in `aidrift-docs/BETA-FEEDBACK-LOG.md`. A stable release requires the documented beta exit gates; elapsed time and user counts are never inferred from automated test runs.
