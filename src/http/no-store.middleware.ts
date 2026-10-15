import type { NextFunction, Request, Response } from "express";

// QUIRK(ios): NSURLCache, like Android's OkHttp cache, answers a max-age response from disk, so a _dev
// change stays invisible. Handlers set Cache-Control after middleware runs, so this wraps `setHeader`
// and `appendHeader` instead of setting a default.
const SHARED_CACHE_DIRECTIVES: ReadonlySet<string> = new Set(["public", "s-maxage"]);
const declared = new WeakMap<Response, string>();

/** WHY: reads what the handler set, before CACHE=off replaced it, so the envelope does not change with that switch. */
export function isSharedCacheable(res: Response): boolean {
  const directives = String(declared.get(res) ?? res.getHeader("Cache-Control") ?? "").split(",");
  return directives.some((d) => SHARED_CACHE_DIRECTIVES.has((d.split("=")[0] ?? "").trim().toLowerCase()));
}

export function noStoreMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const setHeader = res.setHeader.bind(res);
  const appendHeader = res.appendHeader.bind(res);
  const isCacheControl = (name: string): boolean => name.toLowerCase() === "cache-control";
  const replace = (value: number | string | readonly string[]): Response => {
    declared.set(res, String(value));
    return setHeader("Cache-Control", "no-store");
  };
  res.setHeader = ((name: string, value: number | string | readonly string[]) =>
    isCacheControl(name) ? replace(value) : setHeader(name, value)) as Response["setHeader"];
  res.appendHeader = ((name: string, value: string | readonly string[]) =>
    isCacheControl(name) ? replace(value) : appendHeader(name, value)) as Response["appendHeader"];
  setHeader("Cache-Control", "no-store");
  next();
}
