# AIDrift Safety and Resource Limits

AIDRIFT rejects inputs and workloads that exceed these ceilings with exit `2`. The limits are part of the `0.9.0-beta.1` runtime safety boundary; they are not capacity recommendations. Split unusually large projects or narrow the selected artifacts, assertions, models, and probes instead of relying on a partial result.

## Behavioral execution

| Resource                                       |         Limit |
| ---------------------------------------------- | ------------: |
| Samples per assertion or probe                 |           100 |
| Concurrent provider requests                   |            32 |
| Total command deadline                         | 3,600 seconds |
| Eval executions per run                        |       100,000 |
| Probe executions per run                       |       100,000 |
| Probe model targets                            |           100 |
| One provider output                            |         5 MiB |
| Retained provider output per eval or probe run |        16 MiB |
| Provider request input                         |        10 MiB |
| Cached probe entry                             |         6 MiB |
| Probe cache TTL                                |       30 days |

`aidrift check` can report up to 200,000 estimated requests because the separately bounded eval and probe workloads are combined. A successful live-provider check always requires a known, explicit `--cost-budget`; observed unknown costs or a budget overrun fail closed. Provider requests are not retried automatically in this beta.

## Manifests and assertions

| Resource                        |                                                  Limit |
| ------------------------------- | -----------------------------------------------------: |
| Manifest source                 |                                                  2 MiB |
| Manifest or assertion structure | 100,000 nodes, depth 64, 10,000 entries per collection |
| YAML aliases                    |                                                    100 |
| Assertion files                 |                                                    100 |
| One assertion file              |                                                  2 MiB |
| Combined assertion files        |                                                 10 MiB |
| Assertions per suite            |                                                 10,000 |
| Assertion prompt input          |                                   1,048,576 characters |
| Resolved prompt content         |                       10 MiB per file and in aggregate |

JavaScript `regex` assertions are screened for unsafe backtracking and execute with a 250 ms VM deadline. JSON Schema assertions allow only local `$ref`/`$dynamicRef` values, accept at most 2,000 schema nodes, depth 64, 1,000 entries per schema collection, and 100 regex patterns. Schema `pattern` and `patternProperties` values use RE2 syntax: lookaround and backreferences are unsupported. JSON output validation accepts at most 5 MiB, 50,000 nodes, depth 64, 1,000 array items, and 10,000 object properties.

## Project discovery and snapshots

| Resource                        |                                   Limit |
| ------------------------------- | --------------------------------------: |
| Scanner path matches            |                                 100,000 |
| Detected artifacts              |                                  10,000 |
| Dependency manifests            |                10,000 files, 2 MiB each |
| Manifest glob matches           |                                  10,000 |
| `.gitignore` files              | 1,000 files, 1 MiB each, 8 MiB combined |
| Snapshot files in local storage |                                   1,000 |
| Snapshot file size              |                                 128 MiB |
| Snapshot listing input          |                        256 MiB combined |
| Captured artifact files         |                                  10,000 |
| Text artifact                   |            10 MiB each, 64 MiB combined |
| Binary artifact                 |          256 MiB each, 512 MiB combined |
| Persisted provider evidence     |       5 MiB per output, 32 MiB combined |
| Baseline samples                |              100 per assertion or probe |

Discovery does not follow symbolic links. Declared project paths, ignore files, assertion files, artifacts, and snapshot storage are contained within their project boundaries. Snapshot files are immutable, schema-validated, content-hash checked, secret-scanned, and written with owner-only permissions.

## GitHub Action evidence

The Action caps CLI stdout and accepted v3 JSON evidence at 16 MiB and stderr at 1 MiB. It accepts at most 10,000 eval results, 2,000 probe results, and 10,000 artifact results, validates the complete v3 object and its summary consistency, and publishes at most 20 findings in a pull-request comment. Full bounded JSON and JUnit evidence remain available as the workflow artifact when upload is enabled.
