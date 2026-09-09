# Probes And Statistics — Provider Drift Evidence

## When to Read This

Read before changing canonical probes, probe execution/caching, baseline identity, category comparators, statistics, cost evidence, or `aidrift probe`.

## Purpose And Boundary

Provider probes repeatedly execute a versioned canonical input set against declared model artifacts and compare complete current/baseline sample distributions. They detect evidence of changed behavior; they do not prove why a provider changed or guarantee model quality.

The beta ships 20 built-in probes across `deterministic`, `structural`, `semantic`, `behavioral`, and `performance`. User-defined custom probes are not implemented.

## Comparison Strategies

- Deterministic/exact: normalize whitespace, derive the modal baseline output, and score each baseline/current sample against it.
- Structural: apply an explicit deterministic JSON/list/XML structural rule.
- Semantic and behavioral: score explicit required/forbidden concept rubrics. No embedding service or LLM judge is called.
- Performance: compare latency distributions and report the baseline/current mean-latency ratio.

Every comparison uses all retained samples. Binary distributions use Fisher's exact test; continuous distributions use Welch's t-test.

## Status Contract

Probe statuses are `PASS`, `WARN`, `DRIFT`, `INSUFFICIENT`, `ERROR`, and `NEW`.

- `NEW`: no compatible baseline exists.
- `INSUFFICIENT`: either distribution lacks the minimum evidence.
- `DRIFT`: degradation is below the probe threshold and statistically significant.
- `WARN`: degradation is below threshold but not statistically significant.
- `PASS`: stable, improved, or above-threshold evidence.
- `ERROR`: the probe could not produce usable evidence.

Confidence is exposed as `1 - pValue`, explicitly meaning confidence that a regression signal exists—not a probability that the status is universally correct.

## Identity

Baseline compatibility includes snapshot, declared artifact name, provider, model ID, and probe ID. Do not compare evidence from a different identity or silently fall back to another provider. Test-only overrides must remain explicit.

## Execution And Bounds

- Default samples: 5 unless the command/manifest selects another bounded value.
- Default cache TTL: 60 minutes; `--no-cache` bypasses it.
- Cache lives under project-contained `.aidrift/cache/probes` and keys the relevant execution identity/input.
- Apply model, probe, sample, total-execution, concurrency, deadline, response, result-size, and cost ceilings.
- Serialize execution when an observed dollar budget is active.
- Unknown model pricing remains unknown and cannot pass a live dollar ceiling.
- Provider calls are not automatically retried.

`aidrift probe --estimate-cost` performs no live request. Live execution requires the relevant environment credential plus explicit confirmation or a sufficient `--cost-budget`; non-interactive `check` always requires the budget.

## Statistical Rules

- Keep p-values in `[0,1]`, confidence intervals ordered, and results stable under deterministic fixtures.
- Report the actual method, both sample counts, means/standard deviations, delta, p-value, significance level, confidence level/interval, and significance decision.
- Do not report statistical drift from one current and one baseline sample; return `INSUFFICIENT`.
- Do not invent embedding similarity, bootstrap intervals, marginal-significance modes, or environment-variable defaults that the runtime does not implement.
- Maintain property-based tests for numerical range, symmetry, monotonicity, degeneracy, and known distributions.

## Change Checklist

- Version canonical probe changes because they alter baseline meaning.
- Update snapshot baseline capture and identity checks together.
- Add comparator, runner, CLI, output, and packed-flow tests.
- Recheck live cost estimates against first-party provider pricing.
- Preserve bounded, redacted evidence and exit-code behavior.
