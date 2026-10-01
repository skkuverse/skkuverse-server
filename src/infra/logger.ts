import pino, { type Logger, type LoggerOptions } from "pino";
import { loggerOptions } from "./logger-options";

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";

// Production writes JSON to stdout synchronously — no worker thread, so a line
// written just before process.exit() is not lost. Pretty printing is a
// devDependency and absent from the runtime image (Dockerfile `--omit=dev`).
function buildTransport(): LoggerOptions["transport"] {
  if (isTest || isProduction) return undefined;
  return { target: "pino-pretty", options: { colorize: true } };
}

const transport = buildTransport();

const logger: Logger = pino({
  ...loggerOptions(),
  level: isTest
    ? "silent"
    : process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  ...(transport ? { transport } : {}),
});

export = logger;
