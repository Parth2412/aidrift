# Security Policy

## Supported Versions

AIDRIFT has not published a stable release yet. Security issues should still be reported privately.

## Secret Handling

Never commit:

- GitHub tokens
- npm tokens
- PyPI tokens
- AI provider API keys
- `.env` files
- `.aidrift/` snapshots
- `.npmrc` or `.pypirc` files containing credentials

## Local Development

Provider credentials must be supplied through environment variables only.

Snapshots may contain prompt content and must not be committed.

Runtime logs redact common provider, GitHub, npm, PyPI, GitLab, Hugging Face, Slack, AWS, Google, bearer, assignment, URL-password, and private-key formats. Redaction is defense in depth, not permission to pass secrets in command arguments or persist them in evidence.

## Supply-Chain Policy

- Pull requests and protected branches run `pnpm audit --audit-level high`; beta and stable releases allow no known critical or high findings.
- Gitleaks scans committed history. The only path exception is the reproducible checked-in Action bundle; source remains scanned and CI verifies the bundle is current.
- Dependency Review blocks new high-or-critical vulnerable dependencies on pull requests.
- CodeQL analyzes JavaScript and TypeScript on pull requests, protected branches, and a schedule.
- GitHub Actions are pinned to full commit SHAs and updated through Dependabot.
- Release tarballs use strict path allowlists and size budgets, are installed and smoke-tested before publication, and produce a retained CycloneDX SBOM.
- Recurring npm publishing is OIDC-only with provenance and needs no stored npm token.

Default CI is hermetic and receives no model-provider secrets. The separate `provider-smoke` environment may contain narrowly scoped provider credentials; its weekly workflow caps model output, preflight cost, and observed cost.

## Reporting

Use GitHub private vulnerability reporting after the owner enables it under **Settings → Security → Private vulnerability reporting**. Until that remote control is enabled, report issues privately to the repository owner and do not open a public issue containing exploit or credential details.
