import type { LoggerService } from "@nestjs/common";
import logger from "./logger";

// WHY: Nest announces every module and route at boot, over a hundred lines; they drop to debug.
const BOOT_CHATTER = new Set(["InstanceLoader", "RoutesResolver", "RouterExplorer"]);

/**
 * QUIRK(nest): the context is the last string argument, and a multi-line one is the stack of
 * error(message, stack), not a context.
 */
function split(params: unknown[]): { context?: string; rest: unknown[] } {
  const last = params[params.length - 1];
  if (typeof last === "string" && !last.includes("\n")) {
    return { context: last, rest: params.slice(0, -1) };
  }
  return { rest: params };
}

function write(
  level: "debug" | "info" | "warn" | "error" | "fatal",
  message: unknown,
  params: unknown[],
): void {
  const { context, rest } = split(params);
  const fields: Record<string, unknown> = { module: context ? `nest.${context}` : "nest" };
  if (message instanceof Error) {
    logger[level]({ ...fields, err: message }, message.message);
    return;
  }
  const stack = rest.find((p): p is string => typeof p === "string" && p.includes("\n"));
  if (stack) fields.stack = stack;
  logger[level](fields, typeof message === "string" ? message : JSON.stringify(message));
}

export class PinoNestLogger implements LoggerService {
  log(message: unknown, ...params: unknown[]): void {
    const { context } = split(params);
    write(context && BOOT_CHATTER.has(context) ? "debug" : "info", message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    write("error", message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    write("warn", message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    write("debug", message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    write("debug", message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    write("fatal", message, params);
  }
}
