import { ProviderError } from "./errors.js";

export interface LoadProviderApiKeyOptions {
  readonly envVar: string;
  readonly providerId: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function loadProviderApiKey(options: LoadProviderApiKeyOptions): string {
  const env = options.env ?? process.env;
  const value = env[options.envVar];

  if (value === undefined) {
    throw new ProviderError({
      kind: "auth_missing",
      providerId: options.providerId,
      message: `Missing required environment variable ${options.envVar} for provider ${options.providerId}.`,
      fix: `Set ${options.envVar} in your environment before running this command.`,
    });
  }

  return validateProviderApiKey(value, options.providerId, options.envVar);
}

export function validateProviderApiKey(
  value: string,
  providerId: string,
  source = "the supplied API key",
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ProviderError({
      kind: "auth_missing",
      providerId,
      message: `Missing ${source} for provider ${providerId}.`,
      fix: `Set ${source} to a non-empty provider credential before running this command.`,
    });
  }
  if (normalized.length > 4_096 || /[\0\r\n]/u.test(normalized)) {
    throw new ProviderError({
      kind: "auth_invalid",
      providerId,
      message: `Invalid ${source} for provider ${providerId}.`,
      fix: `Replace ${source} with a single-line provider credential no longer than 4096 characters.`,
    });
  }
  return normalized;
}
