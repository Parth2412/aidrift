const REQUIRED_PROVIDER_SECRETS = new Set(["AIDRIFT_OPENAI_API_KEY", "AIDRIFT_ANTHROPIC_API_KEY"]);
const SENSITIVE_NAME =
  /(?:API[_-]?KEY|ACCESS[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY|CREDENTIAL)/iu;

export function childProcessEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !entry[0].startsWith("INPUT_") &&
        entry[0] !== "NODE_OPTIONS" &&
        (REQUIRED_PROVIDER_SECRETS.has(entry[0]) || !SENSITIVE_NAME.test(entry[0])),
    ),
  );
}
