# Generate Tests

When generating tests for a module:

1. **Identify the test layer** — unit, integration, snapshot, or property-based?
2. **Read the testing skill** — `.claude/skills/testing.md` has patterns and examples
3. **Check existing test structure** — follow the naming and organization conventions already in place

## By module type:

### Assertion evaluators

- Mock the LLM provider response (never call live APIs)
- Test: pass case, fail case, edge cases (empty output, timeout, malformed response)
- Test: score is between 0.0 and 1.0
- Test: result matches `AssertionResult` interface

### Provider adapters

- Mock HTTP responses with `nock` or similar
- Test: successful completion, auth error, rate limit, timeout, server error
- Test: cost calculation accuracy
- Test: response normalized to `CompletionResponse` interface

### Statistics engine

- Use property-based tests with `fast-check`
- Test: p-value ∈ [0, 1], symmetry, known distributions
- Test: edge cases (n=1, n=2, identical samples, all-zero variance)

### CLI commands (integration)

- Use VCR-recorded API fixtures
- Test: exit codes (0, 1, 2)
- Test: stdout/stderr separation
- Test: --format json output is valid JSON
- Test: --quiet suppresses non-error output

### Diff engine

- Pure function tests — no mocking needed
- Test: text diff, JSON semantic diff, binary hash diff, parameter diff
- Test: empty diff (no changes), all changed, partial changes

4. **Run tests** — verify they pass
5. **Check coverage** — must be ≥ 85% for new code
