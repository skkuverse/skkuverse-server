import type { Request, Response, NextFunction } from "express";

// QUIRK(cors): `ETag` is not CORS-safelisted, so a browser client can read it to revalidate only once
// it is exposed. enableCors's `exposedHeaders` (main.ts) writes the same value.
export const EXPOSED_RESPONSE_HEADERS = "ETag";

export function exposeHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.set("Access-Control-Expose-Headers", EXPOSED_RESPONSE_HEADERS);
  next();
}
