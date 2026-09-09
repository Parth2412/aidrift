import { describe, expect, it } from "vitest";

import { BUILT_IN_PROBES } from "../../src/probe/canonical.js";
import { compareProbeSamples } from "../../src/probe/comparator.js";
import type {
  CanonicalProbe,
  ProbeBaseline,
  ProbeBaselineSample,
  ProbeSample,
} from "../../src/probe/types.js";

describe("category-aware probe comparison", () => {
  it("classifies controlled exact distributions as stable, warning, or regression", () => {
    const probe = getProbe("deterministic_math");
    const baseline = makeBaseline(Array.from({ length: 5 }, () => "42"));

    const stable = compareProbeSamples(
      probe,
      makeSamples(["42", "42", "42", "42", "42"]),
      baseline,
    );
    const warning = compareProbeSamples(
      probe,
      makeSamples(["42", "42", "42", "42", "41"]),
      baseline,
    );
    const regression = compareProbeSamples(
      probe,
      makeSamples(["41", "41", "41", "41", "41"]),
      baseline,
    );

    expect(stable).toMatchObject({ status: "PASS", score: 1, confidence: 0 });
    expect(warning.status).toBe("WARN");
    expect(warning.statistics).toMatchObject({ method: "fisher_exact", significant: false });
    expect(regression.status).toBe("DRIFT");
    expect(regression.statistics).toMatchObject({
      method: "fisher_exact",
      pValue: 0.003968,
      significant: true,
    });
  });

  it("reports insufficient evidence instead of inventing confidence", () => {
    const comparison = compareProbeSamples(
      getProbe("deterministic_math"),
      makeSamples(["41"]),
      makeBaseline(["42"]),
    );

    expect(comparison).toMatchObject({ status: "INSUFFICIENT", confidence: 0 });
    expect(comparison.explanation).toContain("1 current and 1 baseline");
  });

  it("uses explicit structural parsing rather than text-token overlap", () => {
    const probe = getProbe("structural_json_object");
    const baseline = makeBaseline(Array.from({ length: 5 }, () => '{"name":"a","status":"ok"}'));
    const validDifferentValues = makeSamples(
      Array.from({ length: 5 }, () => '{"status":"changed","name":"different"}'),
    );
    const invalidShape = makeSamples(Array.from({ length: 5 }, () => '{"name":"a","extra":true}'));

    expect(compareProbeSamples(probe, validDifferentValues, baseline).status).toBe("PASS");
    expect(compareProbeSamples(probe, invalidShape, baseline)).toMatchObject({
      status: "DRIFT",
      score: 0,
    });
  });

  it("uses transparent semantic and behavioral rubrics", () => {
    const semantic = getProbe("semantic_reasoning");
    const goodSemantic =
      "Rate limits protect service reliability; clients should use exponential backoff and retry later.";
    const badSemantic = "Clients may ignore limits whenever demand is high.";
    const behavioral = getProbe("behavioral_tool_choice");

    expect(
      compareProbeSamples(
        semantic,
        makeSamples(Array.from({ length: 5 }, () => goodSemantic)),
        makeBaseline(Array.from({ length: 5 }, () => goodSemantic)),
      ).status,
    ).toBe("PASS");
    expect(
      compareProbeSamples(
        semantic,
        makeSamples(Array.from({ length: 5 }, () => badSemantic)),
        makeBaseline(Array.from({ length: 5 }, () => goodSemantic)),
      ).status,
    ).toBe("DRIFT");
    expect(
      compareProbeSamples(
        behavioral,
        makeSamples(Array.from({ length: 5 }, () => "Use refund_create.")),
        makeBaseline(Array.from({ length: 5 }, () => "Use order_lookup.")),
      ).status,
    ).toBe("DRIFT");
  });

  it("compares performance from complete latency distributions", () => {
    const baseline = makeBaseline(
      [98, 100, 101, 99, 102].map((latencyMs) => ({ output: "ok", latencyMs })),
    );
    const current = [198, 200, 201, 199, 202].map((latencyMs) => sample("ok", latencyMs));
    const comparison = compareProbeSamples(getProbe("performance_short"), current, baseline);

    expect(comparison.status).toBe("DRIFT");
    expect(comparison.score).toBeCloseTo(0.5, 2);
    expect(comparison.statistics).toMatchObject({ method: "welch_t", significant: true });
  });

  it("is stable for identical generated distributions across sample counts", () => {
    const probes = [
      getProbe("deterministic_fact"),
      getProbe("structural_xml_tag"),
      getProbe("semantic_rewrite"),
      getProbe("behavioral_boundary"),
      getProbe("performance_medium"),
    ];
    const values: Readonly<Record<string, string>> = {
      deterministic_fact: "H2O",
      structural_xml_tag: "<result>ok</result>",
      semantic_rewrite: "The defect was resolved and released.",
      behavioral_boundary: "Deny access until identity authentication is verified.",
      performance_medium: "consistent",
    };

    for (let sampleCount = 2; sampleCount <= 12; sampleCount += 1) {
      for (const probe of probes) {
        const output = values[probe.id]!;
        const samples = Array.from({ length: sampleCount }, (_, index) =>
          sample(output, 80 + (index % 3)),
        );
        const baseline = makeBaseline(
          samples.map(({ output: baselineOutput, latencyMs }) => ({
            output: baselineOutput,
            latencyMs,
          })),
        );
        expect(compareProbeSamples(probe, samples, baseline).status).toBe("PASS");
      }
    }
  });
});

function getProbe(id: string): CanonicalProbe {
  const probe = BUILT_IN_PROBES.find((candidate) => candidate.id === id);
  if (probe === undefined) throw new Error(`Missing test probe ${id}`);
  return probe;
}

function makeSamples(outputs: readonly string[]): readonly ProbeSample[];
function makeSamples(outputs: readonly ProbeSample[]): readonly ProbeSample[];
function makeSamples(outputs: readonly (string | ProbeSample)[]): readonly ProbeSample[] {
  return outputs.map((value, index) =>
    typeof value === "string" ? sample(value, 10 + index) : value,
  );
}

function makeBaseline(outputs: readonly string[]): ProbeBaseline;
function makeBaseline(outputs: readonly ProbeBaselineSample[]): ProbeBaseline;
function makeBaseline(outputs: readonly (string | ProbeBaselineSample)[]): ProbeBaseline {
  const samples = outputs.map((value) => (typeof value === "string" ? { output: value } : value));
  return {
    output: samples[0]?.output ?? "",
    score: 1,
    provider: "mock",
    model: "mock-v1",
    modelName: "primary",
    probeId: "test",
    samples,
    capturedAt: "2026-09-02T00:00:00.000Z",
  };
}

function sample(output: string, latencyMs: number): ProbeSample {
  return { output, latencyMs, cached: false };
}
