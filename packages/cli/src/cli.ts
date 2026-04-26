#!/usr/bin/env node

const version = "0.0.0";

const helpText = `AIDRIFT ${version}

Terraform for AI behavior.

Usage:
  aidrift --help
  aidrift --version

Bootstrap status:
  Repository foundation is initialized. Product commands are implemented in later phases.
`;

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-V")) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

process.stdout.write(helpText);
