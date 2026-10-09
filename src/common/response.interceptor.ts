import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { map, type Observable } from "rxjs";
import { CACHE_CONTROL_METADATA } from "./cache-control.decorator";

/** A handler's value plus extra `meta` keys; built by withMeta(). */
class WithMeta<T> {
  constructor(
    readonly data: T,
    readonly meta: Readonly<Record<string, unknown>>,
  ) {}
}

/**
 * Return `withMeta(data, { keyword, counts })` from a handler to add keys next
 * to `lang` in the envelope's `meta`. `lang` is always the request's.
 */
export function withMeta<T>(data: T, meta: Readonly<Record<string, unknown>>): WithMeta<T> {
  return new WithMeta(data, meta);
}

/**
 * Global success-envelope interceptor.
 *
 * Bus controllers use @Res() + sendSuccess() and write the response directly
 * (for ETag/304 + extra meta), so for those handlers this interceptor is
 * a no-op: when a handler already wrote the response (res.headersSent) or
 * returned undefined (the @Res() void return), we pass the value through
 * untouched. Health endpoints are also @Res() raw JSON (not enveloped) and are
 * skipped the same way.
 *
 * For any plain handler that DOES return a value, we wrap it in the standard
 * envelope { meta: { lang, ... }, data } and set X-Response-Time — the same
 * envelope sendSuccess() writes. A withMeta() value adds its keys to `meta`,
 * and a handler marked @CacheControl(...) gets that Cache-Control header.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        if (res.headersSent || data === undefined) {
          // @Res() handler already wrote the response (bus + health).
          return data;
        }
        const cacheControl: unknown = Reflect.getMetadata(CACHE_CONTROL_METADATA, ctx.getHandler());
        if (typeof cacheControl === "string") res.setHeader("Cache-Control", cacheControl);
        const start = req.__startNs ?? process.hrtime.bigint();
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
        if (data instanceof WithMeta) {
          return { meta: { lang: req.lang, ...data.meta }, data: data.data };
        }
        return { meta: { lang: req.lang }, data };
      }),
    );
  }
}

/**
 * Writes the success envelope:
 *   res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`)
 *   res.json({ meta: { lang: req.lang, ...meta }, data })
 *
 * `start` is read from req.__startNs (stashed by LangMiddleware at the front of
 * the chain), so the time is measured from request entry. Bus controllers that
 * need ETag/304 control use @Res() and call this directly so they replicate the
 * envelope without going through the global ResponseInterceptor.
 */
export function sendSuccess(
  req: Request,
  res: Response,
  data: unknown,
  meta: Record<string, unknown> = {},
): void {
  const start = req.__startNs ?? process.hrtime.bigint();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
  res.json({ meta: { lang: req.lang, ...meta }, data });
}
