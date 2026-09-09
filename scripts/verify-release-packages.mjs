#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedRepository = "git+https://github.com/Parth2412/aidrift.git";
const expectedNode = "24.20.0";
const publicPackages = [
  {
    name: "@zettacore/aidrift-core",
    directory: "packages/core",
    tarballPrefix: "zettacore-aidrift-core-",
    maximumBytes: 200_000,
    allowedTopLevel: new Set(["dist", "LICENSE", "package.json", "README.md"]),
  },
  {
    name: "@zettacore/aidrift-sdk",
    directory: "packages/sdk",
    tarballPrefix: "zettacore-aidrift-sdk-",
    maximumBytes: 50_000,
    allowedTopLevel: new Set(["dist", "schemas", "LICENSE", "package.json", "README.md"]),
  },
  {
    name: "@zettacore/aidrift",
    directory: "packages/cli",
    tarballPrefix: "zettacore-aidrift-",
    maximumBytes: 100_000,
    allowedTopLevel: new Set(["dist", "LICENSE", "package.json", "README.md"]),
  },
];

const options = parseArguments(process.argv.slice(2));
const temporaryDirectories = [];

try {
  await verifyToolchain(options.platformSmoke);
  const version = await verifyPackageMetadata();
  verifyReleaseTag(version, options.tag ?? process.env["GITHUB_REF_NAME"]);
  await verifyDryRunContents();

  let tarballDirectory;
  if (options.packDestination !== undefined) {
    tarballDirectory = resolveReleaseDestination(options.packDestination);
    await fs.rm(tarballDirectory, { recursive: true, force: true });
    await fs.mkdir(tarballDirectory, { recursive: true });
  } else if (options.installSmoke || options.sbomDestination !== undefined) {
    tarballDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-packages-"));
    temporaryDirectories.push(tarballDirectory);
  }

  if (tarballDirectory !== undefined) {
    const tarballs = await packTarballs(tarballDirectory);
    await verifyPackedManifests(tarballs, version);
    if (options.installSmoke) await smokeTestInstall(tarballs, version);
    if (options.sbomDestination !== undefined) {
      await generateSbom(tarballs, version, options.sbomDestination);
    }
  }

  process.stdout.write(
    `Release package contract verified for ${publicPackages.length} packages at ${version}.\n`,
  );
} finally {
  await Promise.all(
    temporaryDirectories.map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
}

function parseArguments(args) {
  const result = {
    installSmoke: false,
    packDestination: undefined,
    platformSmoke: false,
    sbomDestination: undefined,
    tag: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--install-smoke") {
      result.installSmoke = true;
      continue;
    }
    if (argument === "--platform-smoke") {
      result.installSmoke = true;
      result.platformSmoke = true;
      continue;
    }
    if (
      argument === "--pack-destination" ||
      argument === "--sbom-destination" ||
      argument === "--tag"
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--pack-destination") result.packDestination = value;
      else if (argument === "--sbom-destination") result.sbomDestination = value;
      else result.tag = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}.`);
  }
  return result;
}

async function verifyToolchain(platformSmoke) {
  const configuredNode = (
    await fs.readFile(path.join(repositoryRoot, ".node-version"), "utf8")
  ).trim();
  assert(configuredNode === expectedNode, `.node-version must pin ${expectedNode}.`);
  if (platformSmoke) {
    assert(
      compareVersions(process.versions.node, "22.14.0") >= 0,
      `Platform validation requires Node 22.14.0+; current runtime is ${process.versions.node}.`,
    );
    runNpm(["--version"]);
  } else {
    assert(
      process.versions.node === expectedNode,
      `Release validation requires Node ${expectedNode}; current runtime is ${process.versions.node}.`,
    );
    const npmVersion = runNpm(["--version"]).stdout.trim();
    assert(
      compareVersions(npmVersion, "11.5.1") >= 0,
      `npm 11.5.1+ is required; found ${npmVersion}.`,
    );
  }
}

async function verifyPackageMetadata() {
  const rootManifest = await readJson(path.join(repositoryRoot, "package.json"));
  const actionManifest = await readJson(
    path.join(repositoryRoot, "packages", "action", "package.json"),
  );
  const version = rootManifest.version;
  assert(isSemver(version), `Root version ${String(version)} is not valid SemVer.`);
  assert(
    version.includes("-"),
    "Release candidate must use a prerelease SemVer before beta approval.",
  );
  assert(actionManifest.version === version, "Action and release package versions must match.");

  for (const spec of publicPackages) {
    const packageDirectory = path.join(repositoryRoot, spec.directory);
    const manifest = await readJson(path.join(packageDirectory, "package.json"));
    assert(manifest.name === spec.name, `${spec.directory} has unexpected package name.`);
    assert(manifest.version === version, `${manifest.name} version must equal ${version}.`);
    assert(manifest.license === "Apache-2.0", `${manifest.name} must declare Apache-2.0.`);
    assert(
      manifest.repository?.url === expectedRepository,
      `${manifest.name} repository URL is invalid.`,
    );
    assert(
      manifest.repository?.directory === spec.directory,
      `${manifest.name} repository directory is invalid.`,
    );
    assert(manifest.publishConfig?.access === "public", `${manifest.name} must publish publicly.`);
    assert(
      manifest.publishConfig?.provenance === true,
      `${manifest.name} must request provenance.`,
    );
    assert(manifest.engines?.node === ">=22.14.0", `${manifest.name} must require Node >=22.14.0.`);
    assert(manifest.exports?.["."] !== undefined, `${manifest.name} must define its root export.`);
    if (spec.name === "@zettacore/aidrift") {
      assert(
        manifest.bin?.aidrift === "./dist/cli.js",
        "aidrift must map its executable to ./dist/cli.js.",
      );
    }
    await fs.access(path.join(packageDirectory, "LICENSE"));
  }

  return version;
}

function verifyReleaseTag(version, candidate) {
  if (process.env["GITHUB_REF_TYPE"] !== "tag" && options.tag === undefined) return;
  assert(
    candidate === `v${version}`,
    `Release tag must be v${version}; received ${String(candidate)}.`,
  );
}

async function verifyDryRunContents() {
  for (const spec of publicPackages) {
    const result = runPnpm(["--filter", spec.name, "pack", "--dry-run", "--json"]);
    const report = JSON.parse(result.stdout);
    assert(report.name === spec.name, `Pack report name mismatch for ${spec.name}.`);
    assert(
      Array.isArray(report.files) && report.files.length > 0,
      `${spec.name} tarball is empty.`,
    );
    for (const entry of report.files) {
      const filePath = entry.path;
      assert(typeof filePath === "string", `${spec.name} pack report contains an invalid path.`);
      const topLevel = filePath.split("/")[0];
      assert(
        spec.allowedTopLevel.has(topLevel),
        `${spec.name} tarball contains disallowed path ${filePath}.`,
      );
      assert(
        !isSensitivePath(filePath),
        `${spec.name} tarball contains sensitive path ${filePath}.`,
      );
    }
    for (const required of ["LICENSE", "README.md", "package.json"]) {
      assert(
        report.files.some((entry) => entry.path === required),
        `${spec.name} tarball is missing ${required}.`,
      );
    }
  }
}

async function packTarballs(destination) {
  const tarballs = new Map();
  for (const spec of publicPackages) {
    const report = JSON.parse(
      runPnpm(["--filter", spec.name, "pack", "--pack-destination", destination, "--json"]).stdout,
    );
    const filename = path.resolve(report.filename);
    assert(isInside(destination, filename), `${spec.name} tarball escaped the release directory.`);
    assert(
      path.basename(filename).startsWith(spec.tarballPrefix),
      `${spec.name} tarball name is invalid.`,
    );
    const stat = await fs.stat(filename);
    assert(
      stat.size <= spec.maximumBytes,
      `${spec.name} tarball is ${stat.size} bytes; budget is ${spec.maximumBytes}.`,
    );
    tarballs.set(spec.name, filename);
  }
  return tarballs;
}

async function verifyPackedManifests(tarballs, version) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-packed-manifests-"));
  temporaryDirectories.push(directory);
  const packageJson = path.join(directory, "package.json");
  await fs.writeFile(packageJson, '{"name":"aidrift-packed-manifests","private":true}\n', "utf8");
  runNpm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...publicPackages.map((spec) => requiredTarball(tarballs, spec.name)),
    ],
    directory,
  );
  const installedCli = await readJson(
    path.join(directory, "node_modules", "@zettacore", "aidrift", "package.json"),
  );
  assert(
    installedCli.dependencies?.["@zettacore/aidrift-core"] === version,
    "Packed CLI must pin the matching @zettacore/aidrift-core version.",
  );
  assert(
    installedCli.dependencies?.["@zettacore/aidrift-sdk"] === version,
    "Packed CLI must pin the matching @zettacore/aidrift-sdk version.",
  );
  assert(
    !JSON.stringify(installedCli).includes("workspace:"),
    "Packed CLI must not contain workspace protocols.",
  );
}

async function smokeTestInstall(tarballs, version) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-packed-install-"));
  temporaryDirectories.push(directory);
  await fs.writeFile(
    path.join(directory, "package.json"),
    '{"name":"aidrift-packed-install","private":true,"type":"module"}\n',
    "utf8",
  );
  runNpm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...publicPackages.map((spec) => requiredTarball(tarballs, spec.name)),
    ],
    directory,
  );
  const installedCli = path.join(
    directory,
    "node_modules",
    "@zettacore",
    "aidrift",
    "dist",
    "cli.js",
  );
  const executable =
    process.platform === "win32"
      ? { command: process.execPath, prefix: [installedCli] }
      : {
          command: path.join(directory, "node_modules", ".bin", "aidrift"),
          prefix: [],
        };
  assert(
    run(executable.command, [...executable.prefix, "--version"], directory).stdout.trim() ===
      version,
    "Packed CLI version mismatch.",
  );
  assert(
    run(executable.command, [...executable.prefix, "--help"], directory).stdout.includes(
      "check [options]",
    ),
    "Packed CLI help is incomplete.",
  );
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import('@zettacore/aidrift-core'); await import('@zettacore/aidrift-sdk');",
    ],
    directory,
  );
  await smokeTestGeneratedQuickstart(executable, directory);
  await smokeTestTemplates(executable, directory);
  await smokeTestQuickstart(executable, version, directory);
}

async function smokeTestGeneratedQuickstart(executable, installDirectory) {
  const projectDirectory = path.join(installDirectory, "generated-quickstart");
  await fs.mkdir(projectDirectory);
  const invoke = (args) =>
    run(executable.command, [...executable.prefix, ...args], projectDirectory);

  invoke(["init", "--yes"]);
  await fs.access(path.join(projectDirectory, ".aistate.yml"));
  await fs.access(path.join(projectDirectory, "evals", "starter.assertions.yml"));
  invoke(["validate"]);
  invoke(["snapshot", "--with-evals", "--with-probes", "--samples", "5", "--label", "baseline"]);
  const history = JSON.parse(invoke(["history", "--format", "json"]).stdout);
  assert(Array.isArray(history) && history.length === 1, "Generated history must list baseline.");
  const diff = JSON.parse(invoke(["diff", "--format", "json"]).stdout);
  assert(diff.changedCount === 0, "Generated quickstart diff must be unchanged.");
  const plan = JSON.parse(invoke(["plan", "--samples", "5", "--format", "json"]).stdout);
  assert(plan.summary.regressions === 0, "Generated quickstart plan must pass.");
  const probe = JSON.parse(
    invoke([
      "probe",
      "--model",
      "primary",
      "--category",
      "deterministic",
      "--samples",
      "5",
      "--no-cache",
      "--format",
      "json",
    ]).stdout,
  );
  assert(probe.summary.drifted === 0, "Generated quickstart probe must not drift.");
  const check = invoke(["check", "--samples", "5"]);
  assert(check.stdout.includes("Result: PASS"), "Generated quickstart check must pass.");
}

async function smokeTestTemplates(executable, installDirectory) {
  const templates = [
    { name: "basic-llm", files: [] },
    { name: "rag-pipeline", files: ["rag/config.yml"] },
    { name: "agent", files: ["tools/openapi.yml", "safety/rules.yml"] },
  ];
  for (const template of templates) {
    const projectDirectory = path.join(installDirectory, `template-${template.name}`);
    await fs.mkdir(projectDirectory);
    const invoke = (args) =>
      run(executable.command, [...executable.prefix, ...args], projectDirectory);

    invoke(["init", "--template", template.name]);
    invoke(["validate", "--strict"]);
    invoke(["snapshot", "--label", `template-${template.name}`]);
    await fs.access(path.join(projectDirectory, ".aidrift"));
    const gitignore = await fs.readFile(path.join(projectDirectory, ".gitignore"), "utf8");
    assert(gitignore.includes(".aidrift/"), `${template.name} must ignore snapshot state.`);
    for (const relativePath of template.files) {
      await fs.access(path.join(projectDirectory, relativePath));
    }
  }
}

async function smokeTestQuickstart(executable, version, installDirectory) {
  const source = path.join(repositoryRoot, "examples", "quickstart");
  const projectDirectory = path.join(installDirectory, "quickstart");
  const metadata = await readJson(path.join(source, "example.json"));
  assert(
    metadata.aidriftVersion === version,
    `Quickstart targets ${String(metadata.aidriftVersion)} instead of ${version}.`,
  );
  await fs.cp(source, projectDirectory, { recursive: true });
  await fs.rm(path.join(projectDirectory, ".aidrift"), { recursive: true, force: true });
  const manifestPath = path.join(projectDirectory, ".aistate.yml");
  const invoke = (args) =>
    run(
      executable.command,
      [...executable.prefix, "--config", manifestPath, ...args],
      projectDirectory,
    );

  invoke(["validate"]);
  invoke(["snapshot", "--with-evals", "--with-probes", "--samples", "5", "--label", "clean"]);
  const passingResult = invoke(["check", "--samples", "5", "--format", "json"]);
  assert(
    Buffer.byteLength(passingResult.stdout, "utf8") > 8 * 1024,
    "Quickstart JSON must exercise stdout larger than one 8 KiB write buffer.",
  );
  const passing = JSON.parse(passingResult.stdout);
  assert(passing.passed === true, "Quickstart unchanged check must pass.");

  await fs.copyFile(
    path.join(projectDirectory, "fixtures", "regressed-system.md"),
    path.join(projectDirectory, "prompts", "system.md"),
  );
  const regression = invokeWithStatus(
    executable.command,
    [...executable.prefix, "--config", manifestPath, "check", "--samples", "5", "--format", "json"],
    projectDirectory,
  );
  if (regression.error !== undefined) throw regression.error;
  assert(regression.status === 1, `Quickstart regression must exit 1, got ${regression.status}.`);
  const evidence = JSON.parse(regression.stdout);
  assert(evidence.passed === false, "Quickstart regression evidence must fail.");
  assert(evidence.summary.regressions === 1, "Quickstart must report one eval regression.");
  assert(evidence.artifacts.summary.changed === 1, "Quickstart must report the prompt change.");
}

async function generateSbom(tarballs, version, destinationValue) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aidrift-sbom-"));
  temporaryDirectories.push(directory);
  await fs.writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name: "aidrift-release-bom", version, private: true }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  runNpm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...publicPackages.map((spec) => requiredTarball(tarballs, spec.name)),
    ],
    directory,
  );
  const report = runNpm(["sbom", "--sbom-format", "cyclonedx", "--omit", "dev"], directory).stdout;
  const sbom = JSON.parse(report);
  assert(sbom.bomFormat === "CycloneDX", "SBOM must use CycloneDX format.");
  assert(sbom.specVersion === "1.5", "SBOM must use CycloneDX 1.5.");
  assert(sbom.metadata?.component?.name !== undefined, "SBOM root component is missing.");
  sbom.metadata.component.name = "aidrift-release-bom";
  const names = new Set(
    Array.isArray(sbom.components) ? sbom.components.map((component) => component.name) : [],
  );
  for (const spec of publicPackages) {
    assert(names.has(spec.name), `SBOM is missing ${spec.name}.`);
  }
  const destination = resolveReleaseFile(destinationValue, ".cdx.json");
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.writeFile(destination, `${JSON.stringify(sbom, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function resolveReleaseDestination(value) {
  const releaseRoot = path.join(repositoryRoot, ".release");
  const destination = path.resolve(repositoryRoot, value);
  assert(isInside(releaseRoot, destination), "Pack destination must be inside .release/.");
  return destination;
}

function resolveReleaseFile(value, suffix) {
  const releaseRoot = path.join(repositoryRoot, ".release");
  const destination = path.resolve(repositoryRoot, value);
  assert(isInside(releaseRoot, destination), "Release output must be inside .release/.");
  assert(destination.endsWith(suffix), `Release output must end with ${suffix}.`);
  return destination;
}

function requiredTarball(tarballs, name) {
  const value = tarballs.get(name);
  assert(value !== undefined, `Missing tarball for ${name}.`);
  return value;
}

function runPnpm(args) {
  if (process.platform === "win32") {
    const corepackCli = path.join(
      path.dirname(process.execPath),
      "node_modules",
      "corepack",
      "dist",
      "corepack.js",
    );
    return run(process.execPath, [corepackCli, "pnpm", ...args], repositoryRoot);
  }
  return run("corepack", ["pnpm", ...args], repositoryRoot);
}

function runNpm(args, cwd = repositoryRoot) {
  if (process.platform === "win32") {
    const npmCli = path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    return run(process.execPath, [npmCli, ...args], cwd);
  }
  return run("npm", args, cwd);
}

function run(command, args, cwd = repositoryRoot) {
  const result = invokeWithStatus(command, args, cwd);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${String(result.status)}.\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function invokeWithStatus(command, args, cwd = repositoryRoot) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, "utf8"));
}

function isSensitivePath(filePath) {
  return /(^|\/)(?:\.env|\.npmrc|\.git|src|tests?|fixtures?|coverage)(?:$|\/)|\.(?:pem|key|p12|tgz)$/iu.test(
    filePath,
  );
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function isSemver(value) {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      value,
    )
  );
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
