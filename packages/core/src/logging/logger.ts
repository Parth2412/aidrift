import type { LogLevel } from "../config/types.js";
import { redactSecrets } from "./redact.js";

export interface WritableStreamLike {
  write(chunk: string): unknown;
}

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  trace(message: string): void;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly stderr: WritableStreamLike;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

export function createLogger(options: LoggerOptions): Logger {
  return {
    error: (message) => writeLog("error", message, options),
    warn: (message) => writeLog("warn", message, options),
    info: (message) => writeLog("info", message, options),
    debug: (message) => writeLog("debug", message, options),
    trace: (message) => writeLog("trace", message, options),
  };
}

function writeLog(level: LogLevel, message: string, options: LoggerOptions): void {
  if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[options.level]) {
    return;
  }

  options.stderr.write(`[${level}] ${redactSecrets(message)}\n`);
}
