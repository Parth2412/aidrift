#!/usr/bin/env node

import { runCli } from "./runner.js";

const exitCode = await runCli(process.argv, {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
});

await Promise.all([flush(process.stdout), flush(process.stderr)]);
process.exit(exitCode);

function flush(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write("", (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
