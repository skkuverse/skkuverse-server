import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { map, type Observable } from "rxjs";
import type { WithEtag } from "./response.types";

class EtagEnvelope<T> implements WithEtag<T> {
  constructor(
    readonly data: T,
    readonly etag: string,
    readonly cacheControl?: string,
  ) {}
}

export function withEtag<T>(data: T, etag: string, cacheControl?: string): WithEtag<T> {
  return new EtagEnvelope(data, etag, cacheControl);
}

// WHY: an exact match ends here as a bare 304 (no ETag, Cache-Control or X-Response-Time); a weak or listed
// one reaches Express's freshness check, which answers 304 with those headers. Clients have relied on both.
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      map((value: unknown) => {
        if (!(value instanceof EtagEnvelope)) return value;
        if (req.headers["if-none-match"] === value.etag) {
          res.status(304).end();
          return undefined;
        }
        res.setHeader("ETag", value.etag);
        if (value.cacheControl !== undefined) res.setHeader("Cache-Control", value.cacheControl);
        return value.data;
      }),
    );
  }
}
