# Code Review

When reviewing code (self or external):

## Security Checks (Do First)

- [ ] No API keys in code, tests, fixtures, snapshots, or logs
- [ ] Debug output redacts sensitive data
- [ ] No `eval()` or `Function()` on untrusted input
- [ ] HTTPS for all cloud provider API calls
- [ ] `.aidrift/` is gitignored

## TypeScript Quality

- [ ] No `any` types — use `unknown` + narrowing or proper interfaces
- [ ] Strict mode compliance (no suppressions without justification)
- [ ] All public functions have JSDoc comments
- [ ] Custom error classes used (not raw `Error`)
- [ ] No `console.log` — use structured logger

## Architecture Compliance

- [ ] Code is in the correct module directory (check `architecture.md`)
- [ ] Interfaces are respected (LLMProvider, AssertionEvaluator, etc.)
- [ ] No provider-specific logic outside `src/providers/`
- [ ] No file I/O outside `src/utils/` utility functions
- [ ] Config resolution: CLI flags → env vars → manifest → defaults

## Error Handling

- [ ] All errors include: what, why, how to fix, docs link
- [ ] Errors go to stderr, results to stdout
- [ ] API errors classified: auth, rate_limit, timeout, server, network
- [ ] Retry logic for transient errors with exponential backoff

## Testing

- [ ] New code has tests (≥ 85% coverage)
- [ ] No live API calls in tests (mocked/VCR)
- [ ] Edge cases covered (empty input, timeout, malformed data)
- [ ] CLI commands tested for exit codes

## Performance

- [ ] No blocking operations in hot paths
- [ ] Concurrent execution used where appropriate
- [ ] File I/O is async
