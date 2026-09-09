# @zettacore/aidrift-sdk

Shared AIDrift TypeScript contracts and packaged JSON Schemas.

The current package exposes extension interface scaffolding plus versioned `aidrift check` output schemas and the generated `.aistate.yml` v1 schema. Runtime plugin loading is not implemented; the presence of plugin interfaces does not promise an executable plugin system.

Consumers should pin the exact prerelease package version and validate machine-readable check evidence against the matching schema. `check-output.v1.json` and `check-output.v2.json` remain for compatibility; new output uses `check-output.v3.json`.

The v3 schema includes the beta's execution and evidence cardinality ceilings. Runtime consistency checks—such as unique result identities, exact summary counts, and pass/fail coherence—are additionally enforced by the GitHub Action because JSON Schema cannot express all of those relationships directly.

Version `0.9.0-beta.1` is the first announced public beta on npm's `next` channel. Its interfaces remain prerelease until 1.0.
