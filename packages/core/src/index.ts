export const AIDRIFT_CORE_PACKAGE = "@aidrift/core" as const;

export interface BootstrapStatus {
  readonly packageName: typeof AIDRIFT_CORE_PACKAGE;
  readonly initialized: true;
}

export function getBootstrapStatus(): BootstrapStatus {
  return {
    packageName: AIDRIFT_CORE_PACKAGE,
    initialized: true,
  };
}
