const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
  /\b(?:npm|pypi)-[A-Za-z0-9_-]{8,}\b/gi,
  /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=([^\s]+)/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi,
];

export function redactSecrets(input: string): string {
  return TOKEN_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, redactMatch),
    input,
  );
}

function redactMatch(match: string): string {
  const assignmentIndex = match.indexOf("=");

  if (assignmentIndex > -1) {
    return `${match.slice(0, assignmentIndex + 1)}<redacted>`;
  }

  if (match.toLowerCase().startsWith("bearer ")) {
    return "Bearer <redacted>";
  }

  return "<redacted>";
}
