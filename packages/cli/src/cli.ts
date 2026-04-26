#!/usr/bin/env node

import { runCli } from "./runner.js";

const exitCode = await runCli(process.argv, {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
});

process.exit(exitCode);
