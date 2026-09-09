import type { CheckEvidence, CoreAdapter } from "./types.js";

const MAX_CHECK_EVIDENCE_BYTES = 16 * 1024 * 1024;
const MAX_EVAL_RESULTS = 10_000;
const MAX_PROBE_RESULTS = 2_000;
const MAX_ARTIFACT_RESULTS = 10_000;
const MAX_SAMPLES = 100;
const MAX_TIMEOUT_SECONDS = 3_600;
const MAX_CONCURRENCY = 32;
const MAX_ESTIMATED_REQUESTS = 200_000;

export function parseCheckEvidence(value: string): CheckEvidence {
  if (Buffer.byteLength(value, "utf8") > MAX_CHECK_EVIDENCE_BYTES) {
    throw new Error("AIDRIFT check JSON evidence exceeds the Action safety limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("AIDRIFT check did not return valid JSON evidence.");
  }
  if (!isCheckEvidence(parsed)) {
    throw new Error("AIDRIFT check returned an unsupported or incomplete evidence contract.");
  }
  return parsed;
}

export function emitAnnotations(
  core: CoreAdapter,
  evidence: CheckEvidence,
  manifestPath: string,
): void {
  const properties = { file: manifestPath, startLine: 1 } as const;
  for (const artifact of evidence.artifacts.results) {
    if (artifact.status !== "unchanged") {
      core.notice(
        `AIDRIFT artifact ${artifact.artifactKey}: ${artifact.status} (${artifact.kind}); behavioral evidence determines the gate.`,
        { ...properties, title: `Artifact ${artifact.status}` },
      );
    }
  }
  for (const result of evidence.results) {
    const message = `AIDRIFT assertion ${result.assertionId}: ${result.explanation}`;
    if (result.status === "FAIL") {
      core.error(message, { ...properties, title: "Behavioral regression" });
    } else if (result.status === "WARN") {
      core.warning(message, { ...properties, title: "Behavioral warning" });
    }
  }
  for (const result of evidence.probes.results) {
    const message = `AIDRIFT probe ${result.modelName}/${result.probeId}: ${result.explanation}`;
    if (result.status === "DRIFT" || result.status === "ERROR") {
      core.error(message, { ...properties, title: "Provider drift" });
    } else if (result.status === "WARN" || result.status === "INSUFFICIENT") {
      core.warning(message, { ...properties, title: `Provider ${result.status.toLowerCase()}` });
    }
  }
}

export function renderJunit(evidence: CheckEvidence): string {
  const evalCases = evidence.results.map((result) => {
    const failing =
      result.status === "FAIL" || (result.status === "WARN" && evidence.failOn === "warn");
    return renderTestcase(
      result.assertionId,
      "aidrift.action.eval",
      result.latencyMs / 1_000,
      failing ? (result.status === "FAIL" ? "regression" : "warning") : undefined,
      result.explanation,
    );
  });
  const probeCases = evidence.probes.results.map((result) => {
    const failing =
      result.status === "DRIFT" ||
      result.status === "INSUFFICIENT" ||
      result.status === "ERROR" ||
      (result.status === "WARN" && evidence.failOn === "warn");
    return renderTestcase(
      `${result.modelName}/${result.probeId}`,
      "aidrift.action.probe",
      0,
      failing ? result.status.toLowerCase() : undefined,
      result.explanation,
    );
  });
  const cases = [...evalCases, ...probeCases];
  const failures = countFailures(evidence);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="aidrift-action" tests="${cases.length}" failures="${failures}" errors="0">`,
    `  <testsuite name="aidrift" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">`,
    ...cases,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
}

export function renderErrorJunit(message: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="aidrift-action" tests="1" failures="0" errors="1">`,
    `  <testsuite name="aidrift" tests="1" failures="0" errors="1" skipped="0">`,
    `    <testcase name="configuration" classname="aidrift.action" time="0.000">`,
    `      <error message="AIDRIFT configuration error" type="configuration">${xmlEscape(message)}</error>`,
    "    </testcase>",
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
}

export function renderComment(
  evidence: CheckEvidence | undefined,
  exitCode: number,
  errorMessage: string | undefined,
  artifactUrl: string | undefined,
): string {
  const result =
    exitCode === 0
      ? hasWarnings(evidence)
        ? "⚠️ Warning"
        : "✅ Pass"
      : exitCode === 1
        ? "❌ Fail"
        : "🛑 Error";
  const lines = ["<!-- aidrift-comment -->", `## AIDRIFT Check: ${result}`, ""];
  if (evidence !== undefined) {
    lines.push(
      `- Baseline: \`${markdownEscape(evidence.baselineSnapshotId)}\``,
      `- Artifact changes: ${evidence.artifacts.summary.changed} (informational)`,
      `- Assertions: ${evidence.summary.passed} pass, ${evidence.summary.warned} warn, ${evidence.summary.failed} fail, ${evidence.summary.new} new`,
      `- Probes: ${evidence.probes.summary.passed} pass, ${evidence.probes.summary.warned} warn, ${evidence.probes.summary.drifted} drift, ${evidence.probes.summary.insufficient} insufficient, ${evidence.probes.summary.new} new`,
    );
    const findings = findingLines(evidence).slice(0, 20);
    if (findings.length > 0) lines.push("", "### Findings", "", ...findings);
  } else {
    lines.push(`- ${markdownEscape(errorMessage ?? "AIDRIFT could not produce check evidence.")}`);
  }
  if (artifactUrl !== undefined) {
    lines.push("", `[Download JSON and JUnit evidence](${artifactUrl})`);
  }
  lines.push("", "_This comment is updated in place by AIDRIFT._");
  return lines.join("\n");
}

export function hasWarnings(evidence: CheckEvidence | undefined): boolean {
  return (
    evidence !== undefined &&
    (evidence.summary.warned > 0 ||
      evidence.probes.summary.warned > 0 ||
      evidence.probes.summary.insufficient > 0)
  );
}

export function regressionCount(evidence: CheckEvidence | undefined): number {
  return evidence === undefined
    ? 0
    : evidence.summary.regressions +
        evidence.probes.summary.drifted +
        evidence.probes.summary.insufficient;
}

function isCheckEvidence(value: unknown): value is CheckEvidence {
  if (!isRecord(value) || value["schemaVersion"] !== "3") return false;
  const summary = value["summary"];
  const probes = value["probes"];
  const artifacts = value["artifacts"];
  return (
    hasOnlyKeys(value, [
      "schemaVersion",
      "passed",
      "failOn",
      "baselineSnapshotId",
      "startedAt",
      "completedAt",
      "durationMs",
      "execution",
      "summary",
      "results",
      "probes",
      "artifacts",
    ]) &&
    typeof value["passed"] === "boolean" &&
    (value["failOn"] === "fail" || value["failOn"] === "warn") &&
    boundedString(value["baselineSnapshotId"], 128) &&
    isIsoDateTime(value["startedAt"]) &&
    isIsoDateTime(value["completedAt"]) &&
    Date.parse(value["completedAt"]) >= Date.parse(value["startedAt"]) &&
    finiteNonNegativeNumber(value["durationMs"]) &&
    isExecution(value["execution"]) &&
    isSummary(
      summary,
      ["total", "passed", "warned", "failed", "new", "regressions"],
      MAX_EVAL_RESULTS,
    ) &&
    Array.isArray(value["results"]) &&
    value["results"].length <= MAX_EVAL_RESULTS &&
    value["results"].every(isEvalResult) &&
    uniqueBy(value["results"], (result) => (result as Record<string, unknown>)["assertionId"]) &&
    isRecord(probes) &&
    hasOnlyKeys(probes, ["summary", "results"]) &&
    isProbeSummary(probes["summary"]) &&
    Array.isArray(probes["results"]) &&
    probes["results"].length <= MAX_PROBE_RESULTS &&
    probes["results"].every(isProbeResult) &&
    uniqueBy(
      probes["results"],
      (result) =>
        `${String((result as Record<string, unknown>)["modelName"])}\0${String((result as Record<string, unknown>)["probeId"])}`,
    ) &&
    isRecord(artifacts) &&
    hasOnlyKeys(artifacts, ["gate", "summary", "results"]) &&
    artifacts["gate"] === "informational" &&
    isArtifactSummary(artifacts["summary"]) &&
    Array.isArray(artifacts["results"]) &&
    artifacts["results"].length <= MAX_ARTIFACT_RESULTS &&
    artifacts["results"].every(isArtifactResult) &&
    uniqueBy(
      artifacts["results"],
      (result) => (result as Record<string, unknown>)["artifactKey"],
    ) &&
    evidenceCountsAreConsistent(value)
  );
}

function isExecution(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const costEstimateKnown = value["costEstimateKnown"];
  const knownCostShape =
    costEstimateKnown === true
      ? finiteNonNegativeNumber(value["estimatedCostUsd"]) && value["unknownModels"] === undefined
      : costEstimateKnown === false
        ? value["estimatedCostUsd"] === undefined && isUnknownModelList(value["unknownModels"])
        : false;
  return (
    hasOnlyKeys(value, [
      "samples",
      "timeoutSeconds",
      "concurrency",
      "estimatedRequests",
      "estimatedInputTokens",
      "estimatedOutputTokens",
      "costEstimateKnown",
      "estimatedCostUsd",
      "unknownModels",
      "observedCostUsd",
      "unknownObservedCostSamples",
      "pricingAsOf",
    ]) &&
    boundedInteger(value["samples"], 1, MAX_SAMPLES) &&
    boundedInteger(value["timeoutSeconds"], 1, MAX_TIMEOUT_SECONDS) &&
    boundedInteger(value["concurrency"], 1, MAX_CONCURRENCY) &&
    boundedInteger(value["estimatedRequests"], 0, MAX_ESTIMATED_REQUESTS) &&
    boundedInteger(value["estimatedInputTokens"], 0, Number.MAX_SAFE_INTEGER) &&
    boundedInteger(value["estimatedOutputTokens"], 0, Number.MAX_SAFE_INTEGER) &&
    knownCostShape &&
    finiteNonNegativeNumber(value["observedCostUsd"]) &&
    boundedInteger(value["unknownObservedCostSamples"], 0, MAX_ESTIMATED_REQUESTS) &&
    isIsoDate(value["pricingAsOf"])
  );
}

function isUnknownModelList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 101 &&
    value.every((item) => boundedString(item, 1_024)) &&
    new Set(value).size === value.length
  );
}

function isSummary(value: unknown, keys: readonly string[], maximum: number): boolean {
  return isRecord(value) && hasOnlyKeys(value, keys) && numericFields(value, keys, maximum);
}

function isProbeSummary(value: unknown): boolean {
  return isSummary(
    value,
    ["total", "passed", "warned", "drifted", "insufficient", "errors", "new"],
    MAX_PROBE_RESULTS,
  );
}

function isArtifactSummary(value: unknown): boolean {
  return isSummary(
    value,
    ["total", "changed", "unchanged", "added", "removed"],
    MAX_ARTIFACT_RESULTS,
  );
}

function isEvalResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "assertionId",
      "type",
      "status",
      "score",
      "baselineScore",
      "providerId",
      "sampleCount",
      "latencyMs",
      "costUsd",
      "statistics",
      "explanation",
      "critical",
      "tags",
    ]) &&
    boundedString(value["assertionId"], 128) &&
    ["contains", "regex", "json_schema"].includes(String(value["type"])) &&
    ["PASS", "WARN", "FAIL", "NEW"].includes(String(value["status"])) &&
    boundedNumber(value["score"], 0, 1) &&
    optionalBoundedNumber(value["baselineScore"], 0, 1) &&
    boundedString(value["providerId"], 256) &&
    boundedInteger(value["sampleCount"], 0, MAX_SAMPLES) &&
    boundedNumber(value["latencyMs"], 0, 3_600_000) &&
    finiteNonNegativeNumber(value["costUsd"]) &&
    (value["statistics"] === undefined ||
      isAssertionStatistics(value["statistics"], value["sampleCount"])) &&
    boundedString(value["explanation"], 8_192) &&
    typeof value["critical"] === "boolean" &&
    isTagList(value["tags"])
  );
}

function isProbeResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "modelName",
      "provider",
      "model",
      "probeId",
      "category",
      "status",
      "score",
      "baselineScore",
      "sampleCount",
      "confidence",
      "explanation",
      "statistics",
    ]) &&
    boundedString(value["modelName"], 512) &&
    boundedString(value["provider"], 256) &&
    boundedString(value["model"], 512) &&
    boundedString(value["probeId"], 512) &&
    ["deterministic", "structural", "semantic", "behavioral", "performance"].includes(
      String(value["category"]),
    ) &&
    ["PASS", "WARN", "DRIFT", "INSUFFICIENT", "ERROR", "NEW"].includes(String(value["status"])) &&
    boundedNumber(value["score"], 0, 1) &&
    optionalBoundedNumber(value["baselineScore"], 0, 1) &&
    boundedInteger(value["sampleCount"], 0, MAX_SAMPLES) &&
    boundedNumber(value["confidence"], 0, 1) &&
    boundedString(value["explanation"], 8_192) &&
    (value["statistics"] === undefined ||
      isProbeStatistics(value["statistics"], value["sampleCount"]))
  );
}

function isArtifactResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["artifactKey", "status", "kind"]) &&
    boundedString(value["artifactKey"], 512) &&
    ["unchanged", "added", "removed", "modified"].includes(String(value["status"])) &&
    ["text", "binary", "model"].includes(String(value["kind"]))
  );
}

function isAssertionStatistics(value: unknown, sampleCount: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "method",
      "sampleCount",
      "baselineSampleCount",
      "standardDeviation",
      "baselineStandardDeviation",
      "pValue",
      "significanceLevel",
      "confidenceLevel",
      "confidenceInterval",
      "significant",
    ]) &&
    isSharedStatistics(value) &&
    boundedInteger(value["sampleCount"], 1, MAX_SAMPLES) &&
    value["sampleCount"] === sampleCount &&
    boundedInteger(value["baselineSampleCount"], 1, MAX_SAMPLES) &&
    finiteNonNegativeNumber(value["standardDeviation"]) &&
    finiteNonNegativeNumber(value["baselineStandardDeviation"])
  );
}

function isProbeStatistics(value: unknown, sampleCount: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "method",
      "current",
      "baseline",
      "delta",
      "pValue",
      "significanceLevel",
      "confidenceLevel",
      "confidenceInterval",
      "significant",
    ]) &&
    isSharedStatistics(value) &&
    isDistribution(value["current"]) &&
    value["current"]["sampleCount"] === sampleCount &&
    isDistribution(value["baseline"]) &&
    finiteNumber(value["delta"])
  );
}

function isSharedStatistics(value: Record<string, unknown>): boolean {
  return (
    (value["method"] === "fisher_exact" || value["method"] === "welch_t") &&
    boundedNumber(value["pValue"], 0, 1) &&
    exclusiveUnitNumber(value["significanceLevel"]) &&
    exclusiveUnitNumber(value["confidenceLevel"]) &&
    isNumericPair(value["confidenceInterval"]) &&
    typeof value["significant"] === "boolean"
  );
}

function isDistribution(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["sampleCount", "mean", "standardDeviation"]) &&
    boundedInteger(value["sampleCount"], 1, MAX_SAMPLES) &&
    finiteNumber(value["mean"]) &&
    finiteNonNegativeNumber(value["standardDeviation"])
  );
}

function isNumericPair(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(finiteNumber);
}

function isTagList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((tag) => boundedString(tag, 128)) &&
    new Set(value).size === value.length
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function numericFields(
  value: Record<string, unknown>,
  keys: readonly string[],
  maximum: number,
): boolean {
  return keys.every((key) => boundedInteger(value[key], 0, maximum));
}

function evidenceCountsAreConsistent(value: Record<string, unknown>): boolean {
  const results = value["results"] as readonly Record<string, unknown>[];
  const summary = value["summary"] as Record<string, number>;
  const probes = value["probes"] as {
    readonly summary: Record<string, number>;
    readonly results: readonly Record<string, unknown>[];
  };
  const artifacts = value["artifacts"] as {
    readonly summary: Record<string, number>;
    readonly results: readonly Record<string, unknown>[];
  };
  const evalStatuses = statusCounts(results);
  const probeStatuses = statusCounts(probes.results);
  const artifactStatuses = statusCounts(artifacts.results);
  const expectedPassed =
    countStatus(evalStatuses, "FAIL") === 0 &&
    countStatus(probeStatuses, "DRIFT") === 0 &&
    countStatus(probeStatuses, "INSUFFICIENT") === 0 &&
    countStatus(probeStatuses, "ERROR") === 0 &&
    (value["failOn"] !== "warn" ||
      (countStatus(evalStatuses, "WARN") === 0 && countStatus(probeStatuses, "WARN") === 0));

  return (
    summary["total"] === results.length &&
    summary["passed"] === countStatus(evalStatuses, "PASS") &&
    summary["warned"] === countStatus(evalStatuses, "WARN") &&
    summary["failed"] === countStatus(evalStatuses, "FAIL") &&
    summary["new"] === countStatus(evalStatuses, "NEW") &&
    summary["regressions"] === countStatus(evalStatuses, "FAIL") &&
    probes.summary["total"] === probes.results.length &&
    probes.summary["passed"] === countStatus(probeStatuses, "PASS") &&
    probes.summary["warned"] === countStatus(probeStatuses, "WARN") &&
    probes.summary["drifted"] === countStatus(probeStatuses, "DRIFT") &&
    probes.summary["insufficient"] === countStatus(probeStatuses, "INSUFFICIENT") &&
    probes.summary["errors"] === countStatus(probeStatuses, "ERROR") &&
    probes.summary["new"] === countStatus(probeStatuses, "NEW") &&
    artifacts.summary["total"] === artifacts.results.length &&
    artifacts.summary["changed"] ===
      artifacts.results.length - countStatus(artifactStatuses, "unchanged") &&
    artifacts.summary["unchanged"] === countStatus(artifactStatuses, "unchanged") &&
    artifacts.summary["added"] === countStatus(artifactStatuses, "added") &&
    artifacts.summary["removed"] === countStatus(artifactStatuses, "removed") &&
    value["passed"] === expectedPassed
  );
}

function statusCounts(values: readonly Record<string, unknown>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const status = String(value["status"]);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function countStatus(counts: Readonly<Record<string, number>>, status: string): number {
  return counts[status] ?? 0;
}

function uniqueBy(values: readonly unknown[], select: (value: unknown) => unknown): boolean {
  const selected = values.map(select);
  return (
    selected.every((value) => typeof value === "string") && new Set(selected).size === values.length
  );
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function boundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function optionalBoundedNumber(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || boundedNumber(value, minimum, maximum);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteNonNegativeNumber(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}

function exclusiveUnitNumber(value: unknown): value is number {
  return finiteNumber(value) && value > 0 && value < 1;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value: unknown): value is string {
  if (!boundedString(value, 64) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function boundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function countFailures(evidence: CheckEvidence): number {
  return (
    evidence.summary.failed +
    evidence.probes.summary.drifted +
    evidence.probes.summary.insufficient +
    evidence.probes.summary.errors +
    (evidence.failOn === "warn" ? evidence.summary.warned + evidence.probes.summary.warned : 0)
  );
}

function renderTestcase(
  name: string,
  className: string,
  seconds: number,
  failureType: string | undefined,
  explanation: string,
): string {
  const attributes = `name="${xmlEscape(name)}" classname="${className}" time="${seconds.toFixed(3)}"`;
  if (failureType === undefined) return `    <testcase ${attributes} />`;
  return [
    `    <testcase ${attributes}>`,
    `      <failure message="${xmlEscape(explanation)}" type="${failureType}">${xmlEscape(explanation)}</failure>`,
    "    </testcase>",
  ].join("\n");
}

function findingLines(evidence: CheckEvidence): readonly string[] {
  const evalFindings = evidence.results
    .filter((result) => result.status === "FAIL" || result.status === "WARN")
    .map(
      (result) =>
        `- \`${markdownEscape(result.assertionId)}\` **${result.status}** — ${markdownEscape(result.explanation)}`,
    );
  const probeFindings = evidence.probes.results
    .filter((result) => ["WARN", "DRIFT", "INSUFFICIENT", "ERROR"].includes(result.status))
    .map(
      (result) =>
        `- \`${markdownEscape(`${result.modelName}/${result.probeId}`)}\` **${result.status}** — ${markdownEscape(result.explanation)}`,
    );
  return [...evalFindings, ...probeFindings];
}

function markdownEscape(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!|<>-]/gu, "\\$&").replace(/[\r\n]+/gu, " ");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
