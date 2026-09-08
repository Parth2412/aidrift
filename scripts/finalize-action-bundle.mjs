import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const actionDirectory = path.join(repositoryDirectory, "packages", "action");

await fs.copyFile(
  path.join(actionDirectory, "THIRD_PARTY_NOTICES.md"),
  path.join(actionDirectory, "dist", "THIRD_PARTY_NOTICES.md"),
);

for (const relativePath of ["licenses.txt", path.join("cli", "licenses.txt")]) {
  const licensePath = path.join(actionDirectory, "dist", relativePath);
  const licenseText = await fs.readFile(licensePath, "utf8");
  const normalizedLicenseText = licenseText
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  await fs.writeFile(licensePath, normalizedLicenseText, "utf8");
}
