# Assertions And Eval — Behavioral Evidence

## When to Read This

Read before changing assertion schemas/evaluators, eval targets, sampling, statistical comparison, baseline identity, concurrency, deadlines, or result contracts.

## Supported Assertions

Only three assertion types execute in this release:

- `contains`: require and/or forbid literal substrings.
- `regex`: match a JavaScript regular expression after unsafe-pattern screening.
- `json_schema`: parse JSON and validate it with the bounded RE2-compatible JSON Schema engine.

The manifest/schema reserves `llm_judge`, `tool_call`, `latency`, `cost`, `semantic_stability`, and `custom`, but the parser rejects them with a version-neutral unsupported message. Do not add examples that imply they execute.

Every assertion has a unique `id`, an `input`, and optional description/tags/critical metadata. Suites and their structured values are bounded before execution.

## Execution Target

Behavioral commands require an explicit `eval.target` of type `provider`. It binds execution to one declared model artifact and an ordered set of declared text prompts. Supported model parameters are applied by the selected provider adapter.

HTTP, subprocess, custom, plugin, RAG, tool, safety-policy, adapter, and non-text prompt execution are unavailable. Fail with exit `2`; never substitute mock behavior for an unsupported target.

## Runner Contract

1. Load and validate assertion suites from the manifest-relative suite path.
2. Filter by selected assertion IDs/tags.
3. resolve the explicit provider target and baseline identity.
4. enforce sample, execution-count, concurrency, timeout, response, result-size, and cost bounds.
5. generate each sample and retain score/output/latency/cost evidence.
6. compare the current distribution with compatible baseline samples.
7. return stable assertion ordering, summary counts, identities, totals, and statistical evidence.

Default concurrency is 4. When a live dollar budget is active, execution is serialized so observed spend can stop the workload before the ceiling is exceeded. Provider calls receive the run-wide abort signal.

## Classification

Result statuses are `PASS`, `WARN`, `FAIL`, and `NEW`.

- Baseline/current binary samples use Fisher's exact test.
- Continuous distributions use Welch's t-test.
- Evidence includes sample counts, standard deviations, p-value, significance level, confidence level/interval, and whether the change is significant.
- Identity mismatches, missing samples, or undersized evidence must remain explicit; never invent statistical confidence.
- Allowed regressions may be downgraded only through the documented command contract and must remain visible in evidence.

Statistical utilities have property-based coverage. Changes require known-case tests, boundary tests, symmetry/range invariants where applicable, and end-to-end classification fixtures.

## Safety Rules

- Screen standalone JavaScript regexes for unsafe backtracking and enforce the evaluation deadline.
- Use RE2 syntax for JSON Schema patterns; lookaround and backreferences are unsupported.
- Bound provider output before evaluation and final run output before serialization.
- Never log raw credentials. Treat prompt and provider output as potentially private.
- Reject invalid format, target, credentials, limits, and known-over-budget workloads before a live request.
- Do not automatically retry provider calls.

## Change Checklist

- Update parser/schema/types and both pass/fail evaluator tests.
- Update baseline and statistical comparison tests.
- Update CLI plan/check fixtures and machine-output schemas if evidence changes.
- Maintain the dedicated eval line-coverage floor of at least 90%.
- Rebuild the CLI and checked-in Action bundle.
- Update public limitations and generated references without claiming reserved behavior.
