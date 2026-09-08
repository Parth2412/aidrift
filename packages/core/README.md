# @zettacore/aidrift-core

Core engines for AIDrift behavioral state management.

The package contains manifest validation/runtime guards, secure snapshot capture and storage, semantic diffing, eval execution and statistical comparison, provider adapters, canonical provider probes, cost estimation, and deterministic test providers.

Runtime support is deliberately narrower than the reserved manifest schema. Unsupported providers, storage backends, plugins, eval targets, artifact behavior, and hash modes fail closed rather than producing misleading evidence. Use the repository's generated manifest schema/reference and root README as the public contract.

All parsing, discovery, snapshot, regex, provider-request, and behavioral-execution paths enforce explicit ceilings. JSON Schema regexes use RE2 syntax. See the repository's [safety and resource limits](../../docs/reference/safety-limits.md) before integrating the programmatic API with untrusted project input.

Version `0.9.0-beta.0` is prepared for the `next` channel but is not public until the protected owner bootstrap succeeds. Its API remains prerelease and may change before 1.0.
