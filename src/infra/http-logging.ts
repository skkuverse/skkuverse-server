import { randomUUID } from "crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import type { Logger } from "pino";
import pinoHttp, { type Options } from "pino-http";
import logger from "./logger";
import { runWithLogContext } from "./log-context";
import { serializeError, serializeRequest, serializeResponse } from "./log-redact";

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** QUIRK(cloudflare): CF-Ray is on every proxied request, so the fallback id matches Cloudflare's logs. */
export function resolveRequestId(headers: IncomingMessage["headers"]): string {
  const supplied = headerValue(headers["x-request-id"]);
  if (supplied && VALID_REQUEST_ID.test(supplied)) return supplied;
  const ray = headerValue(headers["cf-ray"]);
  if (ray && VALID_REQUEST_ID.test(ray)) return ray;
  return randomUUID();
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const id = resolveRequestId(req.headers);
  (req as Request & { id: string }).id = id;
  res.setHeader("X-Request-Id", id);
  runWithLogContext({ reqId: id }, next);
}

/** WHY: 401 and 404 stay info: every public API gets them in bulk (expired tokens, scanners probing paths). */
export function accessLogLevel(
  _req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): "error" | "warn" | "info" {
  if (err || res.statusCode >= 500) return "error";
  if (res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 404) return "warn";
  return "info";
}

/** WHY: health probes run every 30 s per container (docker-compose.yml), and are watched elsewhere. */
function isHealthProbe(req: IncomingMessage): boolean {
  return (req.url ?? "").startsWith("/health");
}

/** WHY: the route template, not the URL, so 5xx group per endpoint; set on the access line only, never twice. */
function withRoute<T extends object>(req: IncomingMessage, line: T): T {
  const route = (req as IncomingMessage & { route?: { path?: unknown } }).route?.path;
  return typeof route === "string" ? { ...line, route } : line;
}

export function httpLoggerOptions(target: Logger = logger): Options {
  return {
    logger: target,
    genReqId: (req) => (req as IncomingMessage & { id?: string }).id ?? randomUUID(),
    serializers: {
      req: serializeRequest,
      res: serializeResponse,
      err: serializeError,
    },
    customLogLevel: accessLogLevel,
    autoLogging: { ignore: isHealthProbe },
    customProps: (req) => ({
      appVersion: req.headers["x-app-version"] || null,
      platform: req.headers["x-platform"] || null,
    }),
    customSuccessObject: (req, _res, line: object) => withRoute(req, line),
    customErrorObject: (...args: Parameters<NonNullable<Options["customErrorObject"]>>) =>
      withRoute(args[0], args[3] as object),
  };
}

/**
 * WHY: requestContext first: pino-http adopts its `req.id` (genReqId), and everything after, the access
 * line included, runs inside the scope that carries reqId.
 */
export function mountRequestLogging(app: Express, target: Logger = logger): void {
  app.use(requestContext);
  app.use(pinoHttp(httpLoggerOptions(target)));
}
