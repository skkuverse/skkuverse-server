import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { map, type Observable } from "rxjs";
import { CACHE_CONTROL_METADATA } from "./cache-control.decorator";
import type { SuccessMeta, WithMeta } from "./response.types";

interface SuccessEnvelope {
  meta: Record<string, unknown>;
  data: unknown;
}

class MetaEnvelope<T> implements WithMeta<T> {
  constructor(
    readonly data: T,
    readonly meta: SuccessMeta,
  ) {}
}

export function withMeta<T>(data: T, meta: SuccessMeta): WithMeta<T> {
  return new MetaEnvelope(data, meta);
}

export function startResponseTimer(req: Request): void {
  req.__startNs = process.hrtime.bigint();
}

export function setResponseTime(req: Request, res: Response): void {
  const start = req.__startNs ?? process.hrtime.bigint();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
}

function successEnvelope(req: Request, data: unknown, meta: SuccessMeta = {}): SuccessEnvelope {
  return { meta: { lang: req.lang, ...meta }, data };
}

function handlerWroteResponse(res: Response, data: unknown): boolean {
  return res.headersSent || data === undefined;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        if (handlerWroteResponse(res, data)) return data;
        const cacheControl: unknown = Reflect.getMetadata(CACHE_CONTROL_METADATA, ctx.getHandler());
        if (typeof cacheControl === "string") res.setHeader("Cache-Control", cacheControl);
        setResponseTime(req, res);
        return data instanceof MetaEnvelope
          ? successEnvelope(req, data.data, data.meta)
          : successEnvelope(req, data);
      }),
    );
  }
}

// eslint-disable-next-line max-params -- the @Res() handlers call it with four arguments until ADR 0010 D6 makes it internal to the interceptor
export function sendSuccess(req: Request, res: Response, data: unknown, meta: SuccessMeta = {}): void {
  setResponseTime(req, res);
  res.json(successEnvelope(req, data, meta));
}
