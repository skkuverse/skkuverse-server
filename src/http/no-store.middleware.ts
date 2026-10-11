import type { NextFunction, Request, Response } from "express";

// QUIRK(ios): NSURLCache, like Android's OkHttp cache, answers a max-age response from disk, so a _dev
// change stays invisible. Handlers set Cache-Control after middleware runs, so this wraps `setHeader`
// and `appendHeader` instead of setting a default.
export function noStoreMiddleware(_req: Request, res: Response, next: NextFunction): void {
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
