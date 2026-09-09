# Plugins — Reserved Extensibility Contract

## Current Status

Runtime plugin discovery, loading, installation, isolation, and execution are not implemented. `@zettacore/aidrift-sdk` exposes interface scaffolding only. The manifest reserves a `plugins` field, but runtime commands that would need plugin behavior fail closed when it is populated.

Do not document a plugin CLI, registry, first-party plugin, signing system, or marketplace as available.

## Existing SDK Surface

The SDK currently contains TypeScript interfaces for potential artifact resolvers, assertion evaluators, output formatters, storage backends, and a plugin descriptor. These declarations support design feedback before 1.0; they do not establish a safe loader or compatibility guarantee.

The SDK must remain independent of CLI internals. Public schema and interface changes require coordinated package versioning and migration notes.

## Requirements Before Runtime Implementation

A plugin phase must explicitly decide and test:

- package discovery and namespace rules;
- integrity, provenance, publisher trust, and version compatibility;
- permission disclosure and user consent;
- process isolation or the clearly documented absence of isolation;
- filesystem, network, environment, child-process, and secret access;
- bounded execution, cancellation, output limits, and failure semantics;
- capability registration without global-state mutation;
- conflict resolution and deterministic loading order;
- safe install/remove/update behavior across supported platforms;
- redaction and evidence behavior for plugin errors;
- malicious and malformed plugin tests;
- an incident and revocation process.

Until those controls exist, plugins must remain non-executable and no command may implicitly import packages from `node_modules`.

## Naming Direction

If first-party plugins are introduced, use the controlled ZettaCore scope, such as `@zettacore/aidrift-plugin-<name>`. Community naming and trust indicators must be designed before publication; do not reserve third-party package names by assumption.

## Rules

- Never run arbitrary plugin code during manifest validation, snapshot reading, or package discovery.
- Never treat SDK interface presence as proof of runtime support.
- Keep unsupported manifest use explicit with exit `2`.
- Do not add a direct SDK dependency from core unless the dependency direction is deliberately revised and tested.
- Require a security review before any dynamic import, subprocess, or install path is added.
