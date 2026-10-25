import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import net from "node:net";

const PROXY_HEADERS = new Set(["forwarded", "x-real-ip", "via", "cf-connecting-ip"]);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "[::1]"]);

function isProxied(headers: Request["headers"]): boolean {
  return Object.keys(headers).some((name) => PROXY_HEADERS.has(name) || name.startsWith("x-forwarded-"));
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host || !URL.canParse(`http://${host}`)) return false;
  const { hostname } = new URL(`http://${host}`);
  return LOOPBACK_HOSTNAMES.has(hostname) || (net.isIPv4(hostname) && hostname.startsWith("127."));
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
