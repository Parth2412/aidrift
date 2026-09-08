# Snapshot And Diff — Local Behavioral State

## When to Read This

Read before changing snapshot capture/schema/storage, baseline resolution, `snapshot`, `history`, or `diff`.

## Snapshot Flow

1. Parse and validate the manifest.
2. Reject command-specific unsupported runtime features.
3. Resolve bounded project artifacts relative to the manifest.
4. Capture text/structured content, binary hashes, and model identity/parameters.
5. Optionally execute eval and probe samples for behavioral baselines.
6. attach Git/Node/OS metadata and the manifest hash.
7. validate the complete snapshot schema.
8. write atomically to the configured local snapshot directory.

Snapshots use schema version `1` and collision-resistant IDs in the form `snap_YYYYMMDD_HHMMSS_mmm_<random>`. They may contain private prompt and model-output evidence, so `.aidrift/` is ignored by default.

## Storage

- `local` is the only executable backend.
- The default path is `.aidrift/snapshots`; a custom local path must remain inside the project boundary.
- Writes use exclusive/atomic behavior and never silently replace another snapshot.
- Reads parse and validate the entire persisted object before returning it.
- Baseline selectors may resolve an exact ID, label, tag, or Git commit prefix; ambiguity is an error.
- File counts, sizes, structured complexity, and total snapshot bytes are bounded.

The manifest may reserve other backends, but Git/cloud storage is not implemented.

## Artifact Capture

- Text artifacts store bounded content plus SHA-256 identity.
- JSON/YAML content records its structured content type for semantic diffing.
- Binary artifacts store identity, metadata, and SHA-256 rather than arbitrary file content.
- Model artifacts store provider, model ID, and supported parameter values.
- Custom artifact resolution, RAG hash commands, and MD5 adapter capture are unavailable and fail closed.
- Sensitive filenames and ignored paths are denied; secret redaction is defense in depth, not permission to snapshot secrets.

## Behavioral Baselines

`--with-evals` stores assertion score distributions, outputs, latency/cost evidence, capture identity, and snapshot linkage. `--with-probes` stores all probe samples and provider/model identity. Comparisons must reject incompatible identity rather than treating unrelated baselines as evidence.

## Diff

`aidrift diff` compares two snapshots or the latest snapshot to freshly captured current state. It reports added, removed, modified, and unchanged artifacts.

- Text uses unified line diffs.
- JSON/YAML uses semantic key/index paths rather than formatting-only changes.
- Model artifacts use parameter-level changes.
- Binary artifacts use SHA-256 identity.
- Current-state capture applies the same manifest runtime guards and safety limits as snapshot creation.
- Diff is local and does not call a model provider.

## Shipped Boundary

`rollback`, export/import archives, encryption, watch mode, Git-backed snapshots, and cloud storage are not implemented. Do not document or call them as available.

## Rules

- Preserve snapshot schema compatibility or provide an explicit migration.
- Validate both newly captured and stored snapshots.
- Use atomic writes and project-contained paths.
- Never execute manifest commands or arbitrary plugin code during capture.
- Update core tests, CLI flows, generated/public docs, and clean installed-tarball tests for contract changes.
