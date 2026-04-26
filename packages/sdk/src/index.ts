export const AIDRIFT_SDK_PACKAGE = "@aidrift/sdk" as const;

export interface AIDriftPlugin {
  readonly name: string;
  readonly version: string;
}
