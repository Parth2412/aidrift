import { describe, expect, it } from "vitest";

import { resolveAIDriftConfig } from "../../src/config/resolve.js";

describe("resolveAIDriftConfig", () => {
  it("applies precedence from defaults to manifest to env to cli", () => {
    const config = resolveAIDriftConfig({
      manifest: {
        configPath: "manifest.yml",
        format: "yaml",
        logLevel: "info",
      },
      env: {
        AIDRIFT_CONFIG: "env.yml",
        AIDRIFT_FORMAT: "json",
        AIDRIFT_LOG_LEVEL: "debug",
      },
      cli: {
        configPath: "cli.yml",
        format: "text",
      },
    });

    expect(config).toEqual({
      configPath: "cli.yml",
      format: "text",
      logLevel: "debug",
      color: true,
    });
  });

  it("lets explicit CLI verbosity flags override configured log level", () => {
    expect(
      resolveAIDriftConfig({
        env: { AIDRIFT_LOG_LEVEL: "trace" },
        cli: { quiet: true },
      }).logLevel,
    ).toBe("error");

    expect(
      resolveAIDriftConfig({
        env: { AIDRIFT_LOG_LEVEL: "error" },
        cli: { verbose: true },
      }).logLevel,
    ).toBe("info");
  });

  it("disables color through CLI or NO_COLOR", () => {
    expect(resolveAIDriftConfig({ cli: { noColor: true } }).color).toBe(false);
    expect(resolveAIDriftConfig({ env: { NO_COLOR: "1" } }).color).toBe(false);
  });
});
