import os from "os";
import pino, { type LoggerOptions } from "pino";
import { currentLogContext } from "./log-context";
import { REDACT_PATHS, serializeError } from "./log-redact";

/**
 * Everything about a log line's shape except where it goes and at what level.
 * Separate from logger.ts so tests can build a logger that writes to a buffer
 * with exactly the production options.
 */
export function loggerOptions(): LoggerOptions {
  return {
    // `hostname` is the compose service name (api-1, poller, ...):
    // docker-compose.yml sets it per service, so a line says which replica
    // wrote it.
    base: {
      pid: process.pid,
      hostname: os.hostname(),
      service: "skkuverse-server",
      role: process.env.ROLE || "combined",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    mixin: () => currentLogContext() ?? {},
    serializers: { err: serializeError },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };
}
