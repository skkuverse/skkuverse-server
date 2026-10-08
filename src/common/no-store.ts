import type { NextFunction, Request, Response } from "express";

/**
 * Rewrites every Cache-Control this server sends to `no-store`. Mounted by
 * main.ts only under CACHE=off (the development default).
 *
 * Several routes send `max-age` of five minutes to a day, and the app's HTTP
 * stack honors it: iOS's NSURLCache and Android's OkHttp cache answer from disk,
 * the request never reaches the local server, and a change to a _dev database
 * stays invisible — across app restarts — until the entry expires.
 *
 * Handlers set Cache-Control after middleware runs (Express's `res.set` and
 * Nest's `@Header` both end in `res.setHeader`), so a default set here would be
 * overwritten. This wraps `setHeader` and `appendHeader` instead, which
 * catches every route without touching any of them; `writeHead` with a header
 * object also goes through `setHeader` once a header is already set. ETag and
 * 304 handling are left alone: a revalidation is answered from a freshly
 * computed body, never from a cache.
 */
export function forceNoStore(_req: Request, res: Response, next: NextFunction): void {
  const setHeader = res.setHeader.bind(res);
  const appendHeader = res.appendHeader.bind(res);
  const isCacheControl = (name: string): boolean => name.toLowerCase() === "cache-control";
  res.setHeader = ((name: string, value: number | string | readonly string[]) =>
    setHeader(name, isCacheControl(name) ? "no-store" : value)) as Response["setHeader"];
  res.appendHeader = ((name: string, value: string | readonly string[]) =>
    isCacheControl(name) ? setHeader(name, "no-store") : appendHeader(name, value)) as Response["appendHeader"];
  setHeader("Cache-Control", "no-store");
  next();
}
