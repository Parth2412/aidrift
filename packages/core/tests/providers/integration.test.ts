/**
 * Integration tests for live provider adapters.
 *
 * These tests make real HTTP calls and are skipped automatically when the
 * required API key environment variables are absent. They will never run in CI
 * unless explicitly provided.
 *
 * To run locally:
 *   AIDRIFT_OPENAI_API_KEY=sk-... pnpm test --reporter=verbose packages/core/tests/providers/integration.test.ts
 *   AIDRIFT_ANTHROPIC_API_KEY=sk-ant-... pnpm test --reporter=verbose packages/core/tests/providers/integration.test.ts
 *
 * Each test uses the cheapest available model and sends a single short probe to
 * minimise cost. See docs/development/probe-costs.md for expected cost per run.
 */
import { describe, expect, it } from "vitest";

import { createAnthropicProvider, createOpenAIProvider } from "../../src/providers/index.js";

describe("live provider integration", () => {
  it.skipIf(!process.env.AIDRIFT_OPENAI_API_KEY)(
    "chat-completions adapter returns a valid response shape",
    async () => {
      const provider = createOpenAIProvider({
        model: "gpt-4.1-mini-2025-04-14",
        apiKey: process.env.AIDRIFT_OPENAI_API_KEY!,
      });

      const output = await provider.generate({
        input: "Return only the word ok.",
        probeId: "integration_smoke",
        modelName: "integration",
      });

      expect(typeof output.content).toBe("string");
      expect(output.content.length).toBeGreaterThan(0);
      expect(typeof output.latencyMs).toBe("number");
      expect(output.latencyMs).toBeGreaterThan(0);
      expect(output.costUsd === undefined || typeof output.costUsd === "number").toBe(true);
    },
    30_000,
  );

  it.skipIf(!process.env.AIDRIFT_ANTHROPIC_API_KEY)(
    "messages-API adapter returns a valid response shape",
    async () => {
      const provider = createAnthropicProvider({
        model: "claude-haiku-4-5-20251001",
        apiKey: process.env.AIDRIFT_ANTHROPIC_API_KEY!,
      });

      const output = await provider.generate({
        input: "Return only the word ok.",
        probeId: "integration_smoke",
        modelName: "integration",
      });

      expect(typeof output.content).toBe("string");
      expect(output.content.length).toBeGreaterThan(0);
      expect(typeof output.latencyMs).toBe("number");
      expect(output.latencyMs).toBeGreaterThan(0);
      expect(output.costUsd === undefined || typeof output.costUsd === "number").toBe(true);
    },
    30_000,
  );
});
