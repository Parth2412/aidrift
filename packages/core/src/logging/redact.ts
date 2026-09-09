const TOKEN_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\b(?:npm|pypi|glpat)-[A-Za-z0-9_-]{8,}\b/gi,
  /\bhf_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const ASSIGNMENT_PATTERN = /\b([A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD))\s*=\s*([^\s]+)/gi;
const JSON_SECRET_PATTERN =
  /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|[A-Za-z0-9_.-]+[_-](?:key|token|secret|password))["']?\s*:\s*["']?)([^"',}\s]+)/gi;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/[^:\s/@]+:)[^@\s/]+@/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi;

export function redactSecrets(input: string): string {
  const tokenRedacted = TOKEN_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, "<redacted>"),
    input.replace(BEARER_PATTERN, "Bearer <redacted>"),
  );
  return tokenRedacted
    .replace(ASSIGNMENT_PATTERN, "$1=<redacted>")
    .replace(JSON_SECRET_PATTERN, "$1<redacted>")
    .replace(URL_CREDENTIAL_PATTERN, "$1<redacted>@");
}
