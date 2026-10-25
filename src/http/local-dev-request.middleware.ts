import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isLoopbackAddress } from "../shared/ip-address.util";

const PROXY_HEADERS = new Set(["forwarded", "x-real-ip", "via", "cf-connecting-ip"]);

function isProxied(headers: Request["headers"]): boolean {
  return Object.keys(headers).some((name) => PROXY_HEADERS.has(name) || name.startsWith("x-forwarded-"));
}

function hostnameOf(host: string | undefined): string | null {
  if (!host || !URL.canParse(`http://${host}`)) return null;
  return new URL(`http://${host}`).hostname.replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackHost(host: string | undefined): boolean {
  const hostname = hostnameOf(host);
  return hostname === "localhost" || (hostname !== null && isLoopbackAddress(hostname));
}

// WHY: refuses what a tunnel, a proxy or a rebinding DNS name would bring to a local-dev server (ADR 0023, D2),
// so its permissive perimeter answers this machine only.
@Injectable()
export class LocalDevRequestMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (!isProxied(req.headers) && isLoopbackHost(req.headers.host)) {
      next();
      return;
    }
    res.status(403).json({ error: { code: "LOCAL_DEV_ONLY", message: "A local-development server answers requests from this machine only" } });
  }
}

const filter = new LocalDevRequestMiddleware();

export const localDevRequestFilter: RequestHandler = (req, res, next) => filter.use(req, res, next);
