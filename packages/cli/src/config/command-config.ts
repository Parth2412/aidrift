import path from "node:path";

export function resolveCommandManifestPath(
  cliValue: string | undefined,
  env: Readonly<Record<string, string | undefined>> | undefined,
): string {
  return path.resolve(
    cliValue ?? env?.["AIDRIFT_CONFIG"] ?? process.env["AIDRIFT_CONFIG"] ?? ".aistate.yml",
  );
}

export function resolveCommandFormat(
  cliValue: string | undefined,
  env: Readonly<Record<string, string | undefined>> | undefined,
): string | undefined {
  return cliValue ?? env?.["AIDRIFT_FORMAT"] ?? process.env["AIDRIFT_FORMAT"];
}
