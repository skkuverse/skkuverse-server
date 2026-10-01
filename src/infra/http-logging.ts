/**
 * Request logging, mounted on the raw Express instance by main.ts and by every
 * test app builder, so tests run the production configuration.
 *
 * Order matters: the context middleware assigns the request id and opens the
 * AsyncLocalStorage scope first, then pino-http adopts that id (it only
 * generates one when `req.id` is unset) and binds `req.log`. Everything after
 * — handlers, services, the exception filter and pino-http's own access line —
 * runs inside the scope and carries `reqId`.
 */
import { randomUUID } from "crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import type { Logger } from "pino";
import pinoHttp, { type Options } from "pino-http";
import logger from "./logger";
import { runWithLogContext } from "./log-context";
import { serializeError, serializeRequest, serializeResponse } from "./log-redact";

/** A client-supplied id is adopted only in this shape; anything else is replaced. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The client's X-Request-Id when well-formed, else Cloudflare's CF-Ray (present
 * on every proxied request, so the id matches Cloudflare's own logs), else a
 * fresh UUID for direct and local calls.
 */
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

/**
 * 5xx is an error a person should see; a 4xx is the caller's mistake, worth a
 * warning except for the two every public API gets in bulk (expired tokens and
 * scanners probing paths).
 */
export function accessLogLevel(
  _req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): "error" | "warn" | "info" {
  if (err || res.statusCode >= 500) return "error";
  if (res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 404) return "warn";
  return "info";
}

/** Health probes run every 30 s per container; their outcome is watched elsewhere. */
function isHealthProbe(req: IncomingMessage): boolean {
  return (req.url ?? "").startsWith("/health");
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
  };
}

/** `target` exists for tests that capture output; production uses the shared logger. */
export function mountRequestLogging(app: Express, target: Logger = logger): void {
  app.use(requestContext);
  app.use(pinoHttp(httpLoggerOptions(target)));
}
