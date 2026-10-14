import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { RateLimitPolicy } from "../perimeter/perimeter.ports";

// WHY: bind after RequestAuthenticationMiddleware, which sets req.principal, which the policy may key on.
@Injectable()
export class NoticesRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RequestHandler;

  constructor(policy: RateLimitPolicy) {
    this.limiter = policy.handlerFor("notices");
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
