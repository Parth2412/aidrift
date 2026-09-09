# Testing — Strategy, Patterns, and Coverage

## When to Read This

Read before: writing any tests, setting up test infrastructure, debugging test failures, or when coverage drops below targets.

---

## Coverage Targets

| Scope                | Target | Measurement              |
| -------------------- | ------ | ------------------------ |
| Per-sprint new code  | ≥ 85%  | CI enforcement           |
| MVP overall          | ≥ 90%  | Pre-launch gate          |
| Assertion evaluators | 100%   | Critical path            |
| Statistical engine   | 100%   | Mathematical correctness |

---

## Four Test Layers

### 1. Unit Tests

**What:** Test individual functions and classes in isolation.

**Where:** `packages/cli/tests/unit/`

**Key areas:**

| Module                   | What to Test                                                    | Mocking Strategy                  |
| ------------------------ | --------------------------------------------------------------- | --------------------------------- |
| Manifest parser          | Valid YAML, invalid YAML, edge cases, all artifact types        | No mocking needed (pure function) |
| Artifact hasher          | SHA-256 correctness, binary vs text, empty files                | Mock filesystem                   |
| Diff engine              | Text diff, JSON semantic diff, binary hash diff, parameter diff | No mocking (pure function)        |
| Each assertion evaluator | All 9 types with mocked responses                               | Mock LLM provider responses       |
| Statistics engine        | Known distributions, edge cases, small samples                  | No mocking (pure math)            |
| Provider adapters        | Response parsing, error handling, cost calculation              | Mock HTTP responses               |
| Plugin loader            | Discovery, validation, registration                             | Mock filesystem + require()       |

**Example pattern for assertion tests:**

```typescript
describe("ContainsAssertion", () => {
  it("passes when output contains expected substring", async () => {
    const evaluator = new ContainsAssertion();
    const result = await evaluator.evaluate(
      "What is your policy?",
      { content: "We offer a 30 days full refund policy" },
      { expected_contains: ["30 days", "full refund"] },
    );
    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it("fails when output contains excluded substring", async () => {
    // ...
  });
});
```

### 2. Integration Tests

**What:** Test end-to-end CLI command flows with recorded API responses.

**Where:** `packages/cli/tests/integration/`

**VCR Pattern (API Recording/Replay):**

- Record real API responses once, save as fixtures
- Replay during tests — no live API calls in CI
- Use `nock` or similar HTTP recording library
- Fixture files stored alongside tests in `tests/fixtures/`

**Key integration test flows:**

```
init → validate (manifest is valid)
init → snapshot → history (snapshots are stored and listed)
snapshot → diff (changes detected correctly)
snapshot → plan (full eval flow with recorded API responses)
check → exit code (0 for pass, 1 for fail, 2 for config error)
probe → drift detection (with recorded baseline + current responses)
plugin install → plugin list (plugin lifecycle)
```

**CLI output testing:**

- Capture stdout/stderr
- Assert on exit codes
- Use snapshot testing for output format stability

### 3. Snapshot Tests

**What:** Prevent visual regressions in CLI output formatting.

**Where:** `packages/cli/tests/snapshots/`

**What to snapshot:**

- `aidrift plan` terminal output (the behavioral impact table)
- `aidrift diff` colored output
- `aidrift history` listing
- `aidrift probe` drift report
- Error message formatting
- JSON and JUnit output formats

**When snapshots break:**

- If output changed intentionally → update the snapshot
- If output changed unintentionally → fix the regression

### 4. Property-Based Tests

**What:** Test invariants with randomly generated inputs.

**Where:** `packages/cli/tests/property/`

**Library:** `fast-check`

**What to test with property-based:**

| Property            | Test                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| Statistics engine   | Welch's t-test: symmetric (t(A,B) = -t(B,A))                          |
| Statistics engine   | Fisher's exact: p-value ∈ [0, 1] for any valid contingency table      |
| Statistics engine   | Bootstrap CI: lower bound ≤ point estimate ≤ upper bound              |
| Snapshot comparator | Commutativity: diff(A,B) mirrors diff(B,A)                            |
| Snapshot comparator | Identity: diff(A,A) = no changes                                      |
| SHA-256 hasher      | Deterministic: same input → same hash                                 |
| SHA-256 hasher      | Collision-resistant: different input → different hash (probabilistic) |

**Example:**

```typescript
import fc from "fast-check";

test("Welch t-test p-value is always between 0 and 1", () => {
  fc.assert(
    fc.property(
      fc.array(fc.float({ min: 0, max: 1 }), { minLength: 2, maxLength: 100 }),
      fc.array(fc.float({ min: 0, max: 1 }), { minLength: 2, maxLength: 100 }),
      (sample1, sample2) => {
        const result = welchTTest(sample1, sample2);
        expect(result.p_value).toBeGreaterThanOrEqual(0);
        expect(result.p_value).toBeLessThanOrEqual(1);
      },
    ),
  );
});
```

---

## Test Infrastructure

- **Test runner:** Vitest or Jest (Vitest preferred for Turborepo)
- **Mocking:** Built-in mock functions + `nock` for HTTP
- **Property testing:** `fast-check`
- **Fixtures:** `tests/fixtures/` — recorded API responses, sample manifests, sample snapshots
- **CI integration:** Tests run on every PR via GitHub Actions

---

## Sprint DoD (Definition of Done) for Tests

Each sprint is done when:

1. Unit test coverage ≥ 85% for new code
2. Integration tests pass for the sprint's CLI commands
3. CLI help text is updated for new commands
4. No known crash bugs
5. Self-review checklist completed

---

## Rules

- Every assertion evaluator must have tests with MOCKED LLM responses — never call live APIs in unit tests
- Integration tests use the VCR pattern — record once, replay forever
- Snapshot tests must be reviewed when updated — don't blindly `--update-snapshot`
- Property-based tests are REQUIRED for the statistics engine — mathematical correctness must be proven
- Tests must run in CI without any API keys or network access (except for tagged E2E tests)
- Test file naming: `<module>.test.ts` for unit, `<flow>.integration.test.ts` for integration
- Flaky tests are treated as bugs — fix immediately, don't retry-loop
