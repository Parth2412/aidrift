# @zettacore/aidrift

Local-first behavioral state, regression testing, and provider-drift controls for AI systems.

The CLI implements:

- `init` and `validate` for project setup and manifest validation;
- `snapshot`, `history`, and `diff` for immutable local behavioral state;
- `plan` for sampled eval comparison;
- `probe` for provider-behavior evidence; and
- `check` for a bounded, non-interactive CI gate with exit codes `0`/`1`/`2`.

## Five-Minute Offline Quickstart

The beta must be published before this install command becomes available:

```bash
npm install --global @zettacore/aidrift@0.9.0-beta.0
mkdir aidrift-demo
cd aidrift-demo
aidrift init --yes
aidrift validate
aidrift snapshot --with-evals --with-probes --samples 5 --label baseline
aidrift plan --samples 5
aidrift check --samples 5
```

This needs no API key and no YAML editing. `init` creates a deterministic offline target and starter assertion. Replace that smoke assertion with behavior specific to your application before making it a production gate.

OpenAI and Anthropic execution reads credentials only from `AIDRIFT_OPENAI_API_KEY` and `AIDRIFT_ANTHROPIC_API_KEY`. Live checks require an explicit `--cost-budget`; the deterministic mock provider remains the offline default for development and tests.

See the [complete regression example](https://github.com/Parth2412/aidrift/tree/development/examples/quickstart), [generated CLI reference](https://github.com/Parth2412/aidrift/blob/development/docs/reference/cli.md), and repository README for the supported manifest/runtime boundary. Version `0.9.0-beta.0` is prepared for the `next` channel but is not public until the protected owner bootstrap succeeds.
