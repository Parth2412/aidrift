import { AIDriftError, ExitCode } from "../errors.js";
import { redactSecrets } from "../logging/redact.js";

export type ProviderErrorKind =
  | "auth_missing"
  | "auth_invalid"
  | "bad_request"
  | "rate_limit"
  | "timeout"
  | "server_error"
  | "network_error"
  | "invalid_response"
  | "unknown";

export interface ProviderErrorDetails {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  readonly message: string;
  readonly fix: string;
  readonly retryAfterMs?: number | undefined;
  readonly httpStatus?: number | undefined;
  readonly cause?: unknown;
}

export class ProviderError extends AIDriftError {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  readonly retryAfterMs: number | undefined;
  readonly httpStatus: number | undefined;

  constructor(details: ProviderErrorDetails) {
    super({
      code: `provider.${details.kind}`,
      exitCode: ExitCode.ConfigError,
      what: redactSecrets(details.message),
      why: `Provider ${details.providerId} returned ${details.kind}.`,
      fix: redactSecrets(details.fix),
      cause: details.cause,
    });
    this.name = "ProviderError";
    this.kind = details.kind;
    this.providerId = details.providerId;
    this.retryAfterMs = details.retryAfterMs;
    this.httpStatus = details.httpStatus;
  }
}
