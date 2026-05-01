import { ProviderError } from "./errors.js";

export interface LoadProviderApiKeyOptions {
  readonly envVar: string;
  readonly providerId: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function loadProviderApiKey(options: LoadProviderApiKeyOptions): string {
  const env = options.env ?? process.env;
  const value = env[options.envVar];

  if (value === undefined || value.trim().length === 0) {
    throw new ProviderError({
      kind: "auth_missing",
      providerId: options.providerId,
      message: `Missing required environment variable ${options.envVar} for provider ${options.providerId}.`,
      fix: `Set ${options.envVar} in your environment before running this command.`,
    });
  }

  return value;
}
