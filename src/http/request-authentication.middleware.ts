import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { setResponseTime } from "../infra/response-time";
import { RequestAuthenticator } from "../perimeter/perimeter.ports";
import { toPerimeterRequest } from "./perimeter-request.mapper";

// SEE: docs/decisions/0010-server-architecture.md ("D7. Rate limiting and auth: middleware, declared next to the controllers"):
// a middleware, not a guard: guards run after route middleware, so a principal-keyed limiter would key on the IP and
// answer a bad token 429, not 401.
@Injectable()
export class RequestAuthenticationMiddleware implements NestMiddleware {
  constructor(private readonly authenticator: RequestAuthenticator) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authentication = await this.authenticator.authenticate(toPerimeterRequest(req));
    // WHY: no next() on a rejected credential: the limiter must not count it.
    if (authentication.kind === "rejected") {
      setResponseTime(req, res);
      res.status(401).json({ error: { code: "AUTH_INVALID", message: "Invalid auth token" } });
      return;
    }
    req.principal = authentication;
    next();
  }
}
