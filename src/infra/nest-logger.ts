/**
 * Routes Nest's own framework logs through pino, so a boot writes JSON lines
 * like the rest of the app instead of Nest's coloured console text.
 *
 * Passed to NestFactory.create, so nothing is logged before it is in place.
 * Nest announces every module and route at boot (`InstanceLoader`,
 * `RoutesResolver`, `RouterExplorer` — over a hundred lines); those drop to
 * debug, which production does not write.
 */
import type { LoggerService } from "@nestjs/common";
import logger from "./logger";

const BOOT_CHATTER = new Set(["InstanceLoader", "RoutesResolver", "RouterExplorer"]);

/**
 * Nest passes the context as the last string argument. A multi-line last
 * argument is a stack from error(message, stack), not a context.
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
  // error(message, stack, context): the stack arrives as a string.
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
