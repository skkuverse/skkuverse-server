import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { RateLimitPolicy } from "../perimeter/perimeter.ports";

// WHY: on top of the notices limit for its prefix: each request runs an Atlas $rankFusion with query-time
// embedding and, on a cache miss, an LLM call. Bind it after auth too, which sets req.principal.
@Injectable()
export class NoticesOverviewRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RequestHandler;

  constructor(policy: RateLimitPolicy) {
    this.limiter = policy.handlerFor("notices-overview");
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
