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
import { AppError } from "./app.error";
import { setResponseTime } from "../infra/response-time";

interface ErrorAnswer {
  status: number;
  code: string;
  message: string;
}

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  const message =
    typeof response === "string"
      ? response
      : ((response as { message?: unknown }).message ?? exception.message);
  return Array.isArray(message) ? message.join(", ") : String(message);
}

function errorAnswer(exception: unknown, req: Request): ErrorAnswer | undefined {
  if (exception instanceof AppError) {
    return { status: exception.httpStatus, code: exception.code, message: exception.message };
  }
  if (!(exception instanceof HttpException)) return undefined;
  const status = exception.getStatus();
  if (status === 404) return { status, code: "NOT_FOUND", message: `${req.method} ${req.path} not found` };
  return { status, code: "HTTP_ERROR", message: httpExceptionMessage(exception) };
}

function reportFault(exception: unknown, req: Request): void {
  // WHY: `err` is logged whole: the err serializer (infra/log-redact.ts) drops request config, so an
  // axios error's cookies and query-string keys stay out.
  logger.error(
    { event: "http.unhandled_error", err: exception, method: req.method, path: req.path },
    "Unhandled request error",
  );
  // WHY: the one request-path error that becomes a Sentry Issue; an AppError or HttpException is an
  // answer, not a fault. The request_id tag joins the Issue to this request's log lines.
  Sentry.withScope((scope) => {
    const reqId = currentLogContext()?.reqId;
    if (reqId) scope.setTag("request_id", reqId);
    Sentry.captureException(exception);
  });
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;

    const answer = errorAnswer(exception, req);
    if (answer) {
      setResponseTime(req, res);
      res.status(answer.status).json({ error: { code: answer.code, message: answer.message } });
      return;
    }
    reportFault(exception, req);
    res
      .status(500)
      .json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
}
