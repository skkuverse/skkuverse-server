import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import type { Request, Response } from "express";
import logger from "../infra/logger";
import { currentLogContext } from "../infra/log-context";
import { AppError } from "./app-error";

/**
 * Global error filter. Renders { error: { code, message } } with the correct
 * status + X-Response-Time.
 *
 *  - AppError            → { code, message } at httpStatus.
 *  - NotFoundException   → { NOT_FOUND, "<METHOD> <path> not found" } at 404.
 *  - other HttpException → best-effort code/message at its status.
 *  - unknown error       → 500 INTERNAL_ERROR "Internal server error".
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    if (res.headersSent) {
      return;
    }

    // X-Response-Time is set on every answered error (AppError, the
    // unmatched-route 404, other HttpExceptions) but NOT on the final
    // unknown-error 500, so it is computed + set per-branch below.
    const setResponseTime = (): void => {
      const start = req.__startNs ?? process.hrtime.bigint();
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
    };

    if (exception instanceof AppError) {
      setResponseTime();
      res
        .status(exception.httpStatus)
        .json({ error: { code: exception.code, message: exception.message } });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Nest's default 404 (unmatched route) — replaced by our own message.
      if (status === 404) {
        setResponseTime();
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `${req.method} ${req.path} not found`,
          },
        });
        return;
      }
      const response = exception.getResponse();
      const message =
        typeof response === "string"
          ? response
          : ((response as { message?: unknown }).message ?? exception.message);
      setResponseTime();
      res.status(status).json({
        error: {
          code: "HTTP_ERROR",
          message: Array.isArray(message) ? message.join(", ") : String(message),
        },
      });
      return;
    }

    // Unhandled error → generic 500, with NO X-Response-Time header.
    // reqId comes from the request's log context (infra/log-context.ts); the
    // err serializer strips request config, so an axios error's cookies and
    // query-string keys stay out.
    logger.error(
      { event: "http.unhandled_error", err: exception, method: req.method, path: req.path },
      "Unhandled request error",
    );
    // The one request-path error that becomes a Sentry Issue. AppError and
    // HttpException above are answers, not faults. The tag joins the Issue to
    // this request's log lines.
    Sentry.withScope((scope) => {
      const reqId = currentLogContext()?.reqId;
      if (reqId) scope.setTag("request_id", reqId);
      Sentry.captureException(exception);
    });
    res
      .status(500)
      .json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
}
