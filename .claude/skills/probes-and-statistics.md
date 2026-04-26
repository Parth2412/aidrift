# Probes & Statistics — Provider Drift Detection and Statistical Engine

## When to Read This

Read before: working on `aidrift probe`, modifying canonical probes, implementing statistical tests, working on the statistics engine, or touching anything in `src/probe/` or `src/eval/statistics.ts`.

---

## Probe System Overview

Probes are AIDrift's most differentiated feature. They detect when a model provider silently updates a model — even when the model name hasn't changed.

### How Probes Work

1. **Canonical inputs** — Carefully designed prompts that exercise specific model capabilities
2. **Baseline capture** — When you `aidrift snapshot --with-probes`, probe outputs are stored
3. **Drift comparison** — `aidrift probe` re-sends canonical inputs and compares outputs to baseline
4. **Statistical testing** — Multiple samples per probe, significance testing to distinguish drift from normal non-determinism

---

## Five Probe Categories

### 1. Deterministic (`src/probe/canonical/deterministic.ts`)

Tests math, facts, code execution — things that should have exact answers.

- Comparison: **exact match**
- Example: "What is 1+1?" → expects "2"
- Sensitivity: highest — any change = drift

### 2. Structural (`src/probe/canonical/structural.ts`)

Tests JSON/XML format compliance, list ordering.

- Comparison: **schema + structural diff**
- Example: "Return a JSON object with keys: name, age" → validates structure
- Sensitivity: checks shape, not exact content

### 3. Semantic (`src/probe/canonical/semantic.ts`)

Tests reasoning chains, explanations, summaries.

- Comparison: **embedding cosine similarity**
- Example: "Explain why the sky is blue in 2 sentences"
- Threshold: configurable `min_cosine_similarity` (default: 0.85)
- Uses `cosine-similarity` library

### 4. Behavioral (`src/probe/canonical/behavioral.ts`)

Tests tool calling patterns, refusal behavior, safety compliance.

- Comparison: **pattern matching + LLM judge**
- Example: "I want to harm myself" → expects safety refusal pattern
- Sensitivity: binary (correct behavior or not)

### 5. Performance (`src/probe/canonical/performance.ts`)

Tests latency distribution, token usage patterns.

- Comparison: **statistical distribution comparison**
- Example: Measure p50/p95 latency across N requests
- Drift signal: significant shift in latency or token usage distribution

---

## Probe Execution Flow

```
aidrift probe
    ├── Load probe baselines from latest snapshot
    ├── For each model in manifest:
    │   ├── For each probe category:
    │   │   ├── Send canonical input N times (default: 5)
    │   │   ├── Collect outputs
    │   │   ├── Compare against baseline:
    │   │   │   ├── Exact match (deterministic)
    │   │   │   ├── Structural comparison (JSON/XML)
    │   │   │   ├── Cosine similarity (semantic)
    │   │   │   └── Pattern matching (behavioral)
    │   │   ├── Run statistical significance test
    │   │   └── Classify: PASS | DRIFT | ERROR
    │   └── Aggregate probe results per model
    ├── Cache results with TTL (default: 60 min)
    └── Report drift summary
```

### Built-in Probes

20 canonical probes across all 5 categories. Each probe specifies:

- `id`: unique identifier
- `category`: one of the five categories
- `input`: the canonical prompt
- `comparison_type`: exact | structural | semantic | behavioral | performance
- `threshold`: comparison threshold
- `description`: what this probe tests

### Custom Probes

Users can define custom probes in YAML:

```yaml
probes:
  - id: my_domain_probe
    category: semantic
    input: "Explain quantum entanglement simply"
    comparison_type: semantic
    threshold: 0.85
    target_model: primary
```

---

## Probe Caching (`src/probe/cache.ts`)

- Probe results are cached locally to avoid redundant API calls
- Default TTL: 60 minutes (configurable via `--cache-ttl`)
- Cache key: `{model}:{probe_id}:{input_hash}`
- `--no-cache` bypasses the cache
- Cache stored in `AIDRIFT_CACHE_DIR` (default: `~/.aidrift/cache`)

---

## Statistics Engine (`src/eval/statistics.ts`)

### Welch's t-test

Used for: **continuous metrics** (latency, similarity scores, LLM judge scores)

- Handles unequal variances and unequal sample sizes
- Returns: t-statistic, degrees of freedom, p-value
- Null hypothesis: baseline mean = current mean
- Reject null (drift detected) when p-value < significance level

### Fisher's Exact Test

Used for: **binary metrics** (pass/fail assertions like `contains`, `regex`, `tool_call`)

- Constructs 2x2 contingency table: [baseline_pass, baseline_fail] × [current_pass, current_fail]
- Returns: odds ratio, p-value
- Better than chi-squared for small sample sizes

### Bootstrap Confidence Intervals

Used for: additional confidence measurement when sample sizes are small

- Resamples with replacement (1000 iterations)
- Reports 95% confidence interval for score difference

### Classification Logic

```
For each assertion:
  current_score vs baseline_score

  IF p_value < significance_level AND score_degraded:
    IF below_threshold → FAIL (regression)
    ELSE → WARN (degraded but above threshold)
  ELSE:
    → PASS (stable, improved, or not statistically significant)
```

### Marginal Significance

- Warning mode for marginal results: `0.05 < p < 0.10`
- These get WARN status even if score change appears small

---

## Environment Variables

| Variable                     | Default | Purpose                     |
| ---------------------------- | ------- | --------------------------- |
| `AIDRIFT_SAMPLES`            | 5       | Samples per assertion/probe |
| `AIDRIFT_SIGNIFICANCE_LEVEL` | 0.05    | p-value threshold           |

---

## Rules

- Library: use `simple-statistics` ^7.x for statistical computations
- Never report drift without statistical significance — random non-determinism is NOT drift
- Probe cost estimation must run BEFORE execution (`aidrift probe --estimate-cost`)
- Probe results must be classified as PASS, DRIFT, or ERROR — never ambiguous
- All canonical probes must be deterministic in their design (same input every time)
- Custom probes run alongside built-in probes unless `--exclude-builtin` is specified
- Statistics engine must be tested with property-based tests (fast-check) for correctness
- Welch's t-test requires at least 2 samples — handle edge case of n=1 gracefully
