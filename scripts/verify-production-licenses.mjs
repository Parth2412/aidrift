import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPROVED_LICENSES = new Set([
  "(Apache-2.0 AND BSD-3-Clause)",
  "0BSD",
  "Apache-2.0",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "ISC",
  "MIT",
  "MIT/X11",
  "Unknown",
]);

const currentFile = fileURLToPath(import.meta.url);
const repositoryDirectory = path.resolve(path.dirname(currentFile), "..");

export function validateLicenseInventory(inventory, supplementalNotice) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    throw new Error("Production license inventory must be a JSON object.");
  }

  const unexpectedLicenses = Object.keys(inventory).filter(
    (license) => !APPROVED_LICENSES.has(license),
  );
  if (unexpectedLicenses.length > 0) {
    throw new Error(
      `Unreviewed production license expression(s): ${unexpectedLicenses.sort().join(", ")}.`,
    );
  }

  const unknownPackages = inventory.Unknown;
  if (!Array.isArray(unknownPackages) || unknownPackages.length !== 1) {
    throw new Error(
      "Expected exactly one reviewed package with missing registry license metadata.",
    );
  }

  const [metadataException] = unknownPackages;
  if (
    !metadataException ||
    metadataException.name !== "buffers" ||
    !Array.isArray(metadataException.versions) ||
    metadataException.versions.length !== 1 ||
    metadataException.versions[0] !== "0.1.1"
  ) {
    throw new Error("The only approved missing-metadata exception is buffers@0.1.1.");
  }

  if (
    !supplementalNotice.includes("## buffers 0.1.1") ||
    !supplementalNotice.includes("License: MIT") ||
    !supplementalNotice.includes("Permission is hereby granted")
  ) {
    throw new Error("The buffers@0.1.1 supplemental MIT notice is incomplete.");
  }
}

export async function verifyProductionLicenses() {
  const pnpmEntry = process.env.npm_execpath?.includes("pnpm")
    ? process.env.npm_execpath
    : undefined;
  const executable = pnpmEntry
    ? process.execPath
    : process.platform === "win32"
      ? "pnpm.cmd"
      : "pnpm";
  const args = pnpmEntry
    ? [pnpmEntry, "licenses", "list", "--prod", "--json"]
    : ["licenses", "list", "--prod", "--json"];
  const result = spawnSync(executable, args, {
    cwd: repositoryDirectory,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Could not run pnpm license inventory: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `pnpm license inventory failed with exit ${String(result.status)}: ${result.stderr.trim()}`,
    );
  }

  let inventory;
  try {
    inventory = JSON.parse(result.stdout);
  } catch {
    throw new Error("pnpm returned malformed production license JSON.");
  }

  const supplementalNotice = await fs.readFile(
    path.join(repositoryDirectory, "packages", "action", "THIRD_PARTY_NOTICES.md"),
    "utf8",
  );
  validateLicenseInventory(inventory, supplementalNotice);

  const packageCount = Object.values(inventory).reduce(
    (count, packages) => count + (Array.isArray(packages) ? packages.length : 0),
    0,
  );
  return { licenseExpressions: Object.keys(inventory).length, packageCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    const result = await verifyProductionLicenses();
    console.log(
      `Verified ${result.packageCount} production package license records across ${result.licenseExpressions} expressions.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
