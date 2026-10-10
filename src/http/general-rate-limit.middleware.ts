import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { RateLimitPolicy } from "../perimeter/perimeter.ports";

// WHY: the policy's one handler for its class, taken when Nest builds the middleware for each module that binds it,
// so every binding shares one count.
@Injectable()
export class GeneralRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RequestHandler;

  constructor(policy: RateLimitPolicy) {
    this.limiter = policy.handlerFor("general");
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
