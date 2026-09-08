import {
  AIDriftError,
  createMockProvider,
  ExitCode,
  resolveProviderEvalTarget,
  type AIStateManifest,
  type EvalProvider,
  type EvalExecutionTarget,
  type ResolvedProviderEvalTarget,
} from "@zettacore/aidrift-core";

import {
  buildLiveProvider,
  checkProviderEnvVar,
  type LiveProviderId,
  type ProbeProviderId,
} from "./provider-gate.js";

export interface ResolveCliEvalTargetOptions {
  readonly manifest: AIStateManifest;
  readonly projectRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly providerOverride?: ProbeProviderId | undefined;
  readonly timeoutMs?: number | undefined;
  readonly execute?: boolean | undefined;
}

export function describeCliEvalTarget(target: CliEvalTarget): EvalExecutionTarget {
  return {
    type: "provider",
    providerId: target.providerId,
    modelName: target.target.modelName,
    model: target.target.model.model,
    promptNames: target.target.promptNames,
  };
}

export interface CliEvalTarget {
  readonly target: ResolvedProviderEvalTarget;
  readonly providerId: ProbeProviderId;
  readonly provider: EvalProvider;
}

export async function resolveCliEvalTarget(
  options: ResolveCliEvalTargetOptions,
): Promise<CliEvalTarget> {
  const target = await resolveProviderEvalTarget(options.manifest, options.projectRoot);
  const declaredProvider = parseExecutableProvider(target.model.provider);
  const providerId = options.providerOverride ?? declaredProvider;

  if (providerId === "mock") {
    return {
      target,
      providerId,
      provider: createMockProvider({
        model: target.model.model,
        parameters: target.model.parameters,
        systemPrompt: target.systemPrompt,
      }),
    };
  }

  if (options.execute === false) {
    return {
      target,
      providerId,
      provider: {
        id: providerId,
        generate: async () => {
          throw new Error("Dry-run provider must not be invoked.");
        },
      },
    };
  }

  checkProviderEnvVar(providerId, options.env);
  return {
    target,
    providerId,
    provider: buildLiveProvider(
      providerId,
      {
        name: target.modelName,
        provider: target.model.provider,
        model: target.model.model,
        parameters: target.model.parameters,
      },
      options.env,
      { systemPrompt: target.systemPrompt, timeoutMs: options.timeoutMs },
    ),
  };
}

function parseExecutableProvider(provider: string): ProbeProviderId {
  if (provider === "mock" || provider === "openai" || provider === "anthropic") {
    return provider;
  }
  throw new AIDriftError({
    code: "eval.provider.unsupported",
    exitCode: ExitCode.ConfigError,
    what: `Unsupported eval target provider: ${provider}.`,
    why: "The direct provider target currently supports mock, openai, and anthropic only.",
    fix: "Select a supported model artifact or wait for HTTP/subprocess target execution.",
    docs: "https://github.com/Parth2412/aidrift#readme",
  });
}
