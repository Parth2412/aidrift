export enum ExitCode {
  Success = 0,
  Failure = 1,
  ConfigError = 2,
}

export interface AIDriftErrorDetails {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly what: string;
  readonly why: string;
  readonly fix: string;
  readonly docs?: string | undefined;
  readonly cause?: unknown;
}

export class AIDriftError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly what: string;
  readonly why: string;
  readonly fix: string;
  readonly docs: string | undefined;

  constructor(details: AIDriftErrorDetails) {
    super(details.what, { cause: details.cause });
    this.name = "AIDriftError";
    this.code = details.code;
    this.exitCode = details.exitCode;
    this.what = details.what;
    this.why = details.why;
    this.fix = details.fix;
    this.docs = details.docs;
  }
}

export function formatAIDriftError(error: AIDriftError): string {
  const docs = error.docs === undefined ? "" : `\n  Docs: ${error.docs}`;

  return `Error: ${error.what}
  Code: ${error.code}
  Reason: ${error.why}
  Fix: ${error.fix}${docs}
`;
}
