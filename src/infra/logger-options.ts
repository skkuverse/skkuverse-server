import os from "os";
import pino, { type LoggerOptions } from "pino";
import { currentLogContext } from "./log-context";
import { REDACT_PATHS, serializeError } from "./log-redact";
import { envRole } from "./required-env";

/** WHY: apart from logger.ts, so a test can build a logger that writes to a buffer with exactly these options. */
export function loggerOptions(): LoggerOptions {
  return {
    // WHY: docker-compose.yml sets `hostname` per service (api-1, poller), so a line names its replica.
    base: {
      pid: process.pid,
      hostname: os.hostname(),
      service: "skkuverse-server",
      role: envRole(process.env),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // QUIRK(pino): the default mixinMergeStrategy is Object.assign(mixinObject, lineFields), so
    // returning the store itself would write each line's fields into every later line of the request.
    mixin: () => ({ ...currentLogContext() }),
    serializers: { err: serializeError },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };
}
