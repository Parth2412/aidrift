#!/usr/bin/env node

import fs from "node:fs/promises";

const [filename, expectedProvider, rawMaximumCost] = process.argv.slice(2);
if (filename === undefined || expectedProvider === undefined || rawMaximumCost === undefined) {
  throw new Error("Usage: verify-live-smoke.mjs <result.json> <provider> <maximum-cost-usd>");
}
const maximumCostUsd = Number(rawMaximumCost);
if (!Number.isFinite(maximumCostUsd) || maximumCostUsd < 0) {
  throw new Error("Maximum live-smoke cost must be a finite non-negative number.");
}

const report = JSON.parse(await fs.readFile(filename, "utf8"));
assert(report.providerId === expectedProvider, "Live-smoke provider identity is incorrect.");
assert(report.requestedSamples === 1, "Live smoke must request exactly one sample per probe.");
assert(report.summary?.total === 4, "Live smoke must run the four deterministic probes.");
assert(report.summary?.errors === 0, "A live-smoke probe returned an execution error.");
assert(report.unknownCostSamples === 0, "Live-smoke cost evidence is incomplete.");
assert(
  typeof report.totalCostUsd === "number" && report.totalCostUsd <= maximumCostUsd,
  "Live-smoke observed cost exceeded its configured ceiling.",
);
assert(
  Array.isArray(report.results) &&
    report.results.every(
      (result) =>
        result.provider === expectedProvider &&
        Array.isArray(result.samples) &&
        result.samples.length === 1,
    ),
  "Live-smoke result identity or sample evidence is invalid.",
);

process.stdout.write(
  `Verified ${expectedProvider} live smoke: ${report.summary.total} probes, $${report.totalCostUsd.toFixed(6)}.\n`,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
