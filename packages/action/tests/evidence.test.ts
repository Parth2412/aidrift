import { describe, expect, it } from "vitest";

import {
  emitAnnotations,
  parseCheckEvidence,
  regressionCount,
  renderComment,
  renderErrorJunit,
  renderJunit,
} from "../src/evidence.js";
import { createCore, passingEvidence } from "./helpers.js";

describe("Action evidence", () => {
  it("parses v3 evidence and rejects stale or incomplete contracts", () => {
    const evidence = passingEvidence();
    expect(parseCheckEvidence(JSON.stringify(evidence))).toEqual(evidence);
    expect(() => parseCheckEvidence("not-json")).toThrow("valid JSON");
    expect(() => parseCheckEvidence('{"schemaVersion":"2"}')).toThrow("unsupported");
  });

  it("rejects contradictory counts, duplicate identities, and invalid numeric evidence", () => {
    const inconsistent = passingEvidence({
      summary: { total: 2, passed: 1, warned: 0, failed: 0, new: 0, regressions: 0 },
    });
    expect(() => parseCheckEvidence(JSON.stringify(inconsistent))).toThrow("unsupported");

    const duplicate = passingEvidence();
    const duplicateResults = {
      ...duplicate,
      results: [...duplicate.results, ...duplicate.results],
    };
    expect(() => parseCheckEvidence(JSON.stringify(duplicateResults))).toThrow("unsupported");

    const invalidScore = passingEvidence({
      results: [{ ...passingEvidence().results[0]!, score: -1 }],
    });
    expect(() => parseCheckEvidence(JSON.stringify(invalidScore))).toThrow("unsupported");
  });

  it("rejects incomplete execution metadata, malformed statistics, and unknown fields", () => {
    const evidence = passingEvidence();
    const { execution: _execution, ...missingExecution } = evidence;
    expect(() => parseCheckEvidence(JSON.stringify(missingExecution))).toThrow("unsupported");

    const malformedStatistics = passingEvidence({
      results: [
        {
          ...evidence.results[0]!,
          statistics: {
            method: "welch_t",
            sampleCount: 2,
            baselineSampleCount: 1,
            standardDeviation: 0,
            baselineStandardDeviation: 0,
            pValue: 0.5,
            significanceLevel: 0.05,
            confidenceLevel: 0.95,
            confidenceInterval: [0, 1],
            significant: false,
          },
        },
      ],
    });
    expect(() => parseCheckEvidence(JSON.stringify(malformedStatistics))).toThrow("unsupported");

    expect(() =>
      parseCheckEvidence(JSON.stringify({ ...evidence, unversionedField: true })),
    ).toThrow("unsupported");
  });

  it("derives annotations, JUnit, counts, and a bounded redacted comment", () => {
    const evidence = passingEvidence({
      passed: false,
      summary: { total: 1, passed: 0, warned: 0, failed: 1, new: 0, regressions: 1 },
      results: [
        {
          ...passingEvidence().results[0]!,
          assertionId: "safety|boundary",
          status: "FAIL",
          score: 0,
          baselineScore: 1,
          latencyMs: 12,
          explanation: "missing <safe>\nvalue",
        },
      ],
      probes: {
        summary: {
          total: 1,
          passed: 0,
          warned: 0,
          drifted: 0,
          insufficient: 1,
          errors: 0,
          new: 0,
        },
        results: [
          {
            ...passingEvidence().probes.results[0]!,
            modelName: "primary",
            probeId: "semantic_summary",
            status: "INSUFFICIENT",
            score: 0,
            explanation: "Need more samples.",
          },
        ],
      },
      artifacts: {
        gate: "informational",
        summary: { total: 1, changed: 1, unchanged: 0, added: 0, removed: 0 },
        results: [{ artifactKey: "prompts/system", status: "modified", kind: "text" }],
      },
    });
    const test = createCore();
    emitAnnotations(test.core, evidence, ".aistate.yml");

    expect(test.errors).toHaveLength(1);
    expect(test.warnings).toHaveLength(1);
    expect(test.notices).toHaveLength(1);
    expect(regressionCount(evidence)).toBe(2);
    const junit = renderJunit(evidence);
    expect(junit).toContain('tests="2" failures="2"');
    expect(junit).toContain("missing &lt;safe&gt;");
    const comment = renderComment(evidence, 1, undefined, "https://example/artifact");
    expect(comment).toContain("<!-- aidrift-comment -->");
    expect(comment).toContain("AIDRIFT Check: ❌ Fail");
    expect(comment).toContain("safety\\|boundary");
    expect(comment).not.toContain("\nvalue\n");
    expect(comment).toContain("https://example/artifact");
  });

  it("renders a standards-shaped configuration error suite", () => {
    const junit = renderErrorJunit("bad <manifest>");
    expect(junit).toContain('errors="1"');
    expect(junit).toContain("bad &lt;manifest&gt;");
  });
});
