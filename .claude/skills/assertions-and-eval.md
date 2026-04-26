# Assertions & Eval — Behavioral Testing Engine

## When to Read This

Read before: implementing or modifying assertion evaluators, working on the eval runner, adding new assertion types, working on assertion YAML parsing, or touching anything in `src/eval/`.

---

## Assertion YAML Schema

```yaml
# evals/my_assertions.assertions.yml
suite: customer_support
description: "Behavioral assertions for customer support chatbot"

assertions:
  - id: greeting_tone # Unique ID (required)
    description: "Warm and professional" # Human description
    type: llm_judge # Assertion type (required)
    tags: [tone, safety] # For filtering with --tags
    critical: false # If true, always FAIL (never WARN)
    input: "Hi, I need help" # Input to send to AI system
    # ... type-specific fields below
```

---

## Nine Built-in Assertion Types

### 1. `contains` — Substring check

```yaml
type: contains
input: "What's your refund policy?"
expected_contains:
  - "30 days"
  - "full refund"
expected_not_contains:
  - "no refunds"
  - "store credit only"
```

**Score:** 1.0 if all contains match and no not_contains match; 0.0 otherwise.

### 2. `regex` — Pattern matching

```yaml
type: regex
input: "Generate an order ID"
pattern: "^ORD-[A-Z0-9]{8}$"
flags: "i" # Optional regex flags
```

**Score:** 1.0 if pattern matches; 0.0 otherwise.

### 3. `json_schema` — Structured output validation

```yaml
type: json_schema
input: "List my recent orders as JSON"
expected_schema:
  type: object
  properties:
    orders:
      type: array
      items:
        type: object
        required: ["id", "status", "date"]
```

**Score:** 1.0 if output is valid JSON matching the schema; 0.0 otherwise.

### 4. `llm_judge` — LLM-as-judge evaluation

```yaml
type: llm_judge
input: "Hi, I need help with my order"
judge:
  criteria: "Response is warm, professional, and asks clarifying questions"
  model: gpt-4o-mini # Cheaper model for judging
  threshold: 0.8 # 80% of samples must pass
```

**Score:** Percentage of samples the judge deems passing (0.0–1.0).
**Implementation:** `src/eval/assertions/llm-judge.ts` — sends output + criteria to judge model, parses pass/fail + reasoning.

### 5. `tool_call` — Tool/function call verification

```yaml
type: tool_call
input: "Where is my order #12345?"
expected_tool: order_lookup
expected_args:
  order_id: "12345"
```

**Score:** 1.0 if correct tool called with correct args; partial score for correct tool with wrong args.

### 6. `latency` — Response time check

```yaml
type: latency
input: "Hello"
max_p95_ms: 3000 # p95 latency threshold
```

**Score:** 1.0 if p95 within threshold; degrades proportionally beyond threshold.

### 7. `cost` — Token cost check

```yaml
type: cost
input: "Tell me about your products"
max_cost_usd: 0.05
```

**Score:** 1.0 if average cost within budget; 0.0 if exceeds.

### 8. `semantic_stability` — Output consistency

```yaml
type: semantic_stability
input: "Explain your return process"
min_cosine_similarity: 0.85
samples: 10 # Overrides global sample count
```

**Score:** Average pairwise cosine similarity across samples.
**Implementation:** Runs input N times, computes embeddings, calculates all pairwise cosine similarities.

### 9. `custom` — User-defined function

```yaml
type: custom
input: "Generate a report"
command: "python ./evals/custom_checker.py"
input_format: json # {"input": "...", "output": "..."}
output_format: json # {"score": 0.95, "passed": true, "reason": "..."}
```

**Score:** Whatever the subprocess returns.

---

## Eval Runner (`src/eval/runner.ts`)

### Execution Flow

```
1. Load assertion YAML files from eval suite directory
2. Filter assertions by --assertions or --tags if specified
3. For each assertion:
   a. Send input to AI system N times (samples_per_assertion)
   b. Evaluate each output with the assertion evaluator
   c. Aggregate scores across samples
   d. Compare aggregated score to baseline from snapshot
   e. Run statistical significance test (Welch's t-test or Fisher's exact)
   f. Classify: PASS (stable/improved) | WARN (degraded, above threshold) | FAIL (regression)
4. Collect all results
5. Format and output
```

### AI System Interaction Modes

The executor (`src/eval/executor.ts`) supports three modes:

| Mode         | Config                                                       | How It Works                                                  |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `provider`   | Uses model config from manifest                              | Direct API call to LLM provider                               |
| `http`       | `url`, `method`, `headers`, `body_template`, `response_path` | HTTP POST to AI system endpoint                               |
| `subprocess` | `command`, `input_format`, `output_format`                   | Runs script, passes input via stdin, reads output from stdout |

### Concurrency

- `src/eval/runner.ts` uses configurable parallelism
- Default: 5 concurrent assertion evaluations
- Each assertion's N samples run sequentially (to avoid rate limits)
- Provider rate limit handling: exponential backoff with jitter

---

## AssertionResult Interface

```typescript
interface AssertionResult {
  assertion_id: string;
  passed: boolean;
  score: number; // 0.0 – 1.0
  confidence: number; // Statistical confidence
  p_value?: number;
  details: {
    expected: string;
    actual: string;
    explanation: string;
  };
  samples: SampleResult[];
  latency_ms: number;
  cost_usd: number;
}
```

---

## Rules

- Every assertion evaluator MUST implement the `AssertionEvaluator` interface from `src/eval/assertions/interface.ts`
- Every assertion returns a score between 0.0 and 1.0
- Assertion evaluators must be stateless — no side effects between invocations
- `llm_judge` should use a cheaper/faster model than the system under test (e.g., `gpt-4o-mini`)
- `custom` assertions run in a subprocess — never execute user code in the main process
- The eval runner must respect `--budget` limits — estimate cost before running, abort if budget exceeded
- The eval runner must respect `--timeout` limits
- Assertion YAML files use the naming convention `*.assertions.yml`
- All assertion types must have unit tests with mocked LLM responses
