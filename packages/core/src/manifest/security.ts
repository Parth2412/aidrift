import type { ManifestValidationIssue } from "./types.js";

import { redactSecrets } from "../logging/redact.js";

const SECRET_KEY_PATTERN =
  /(^|_|\b)(api[_-]?key|token|secret|password|authorization|bearer)(_|$|\b)/iu;
export function findManifestSecrets(value: unknown): readonly ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];
  visitValue(value, "$", issues);
  return issues;
}

export function containsSecretLikeValue(value: string): boolean {
  return redactSecrets(value) !== value;
}

function visitValue(value: unknown, manifestPath: string, issues: ManifestValidationIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitValue(item, `${manifestPath}[${index}]`, issues));
    return;
  }

  if (value !== null && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      const childPath = manifestPath === "$" ? key : `${manifestPath}.${key}`;

      if (SECRET_KEY_PATTERN.test(key)) {
        issues.push({
          severity: "error",
          code: "manifest.secret.disallowed",
          message: `Secret-like key "${key}" is not allowed in .aistate.yml.`,
          manifestPath: childPath,
          fix: "Move credentials to environment variables or GitHub Actions secrets.",
        });
      }

      visitValue(item, childPath, issues);
    });
    return;
  }

  if (typeof value !== "string") {
    return;
  }

  if (containsSecretLikeValue(value)) {
    issues.push({
      severity: "error",
      code: "manifest.secret.disallowed",
      message: "Secret-like value is not allowed in .aistate.yml.",
      manifestPath,
      fix: "Move credentials to environment variables or GitHub Actions secrets.",
    });
  }
}
