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

## Reporting

Until a public security contact is configured, report security issues privately to the repository owner.
