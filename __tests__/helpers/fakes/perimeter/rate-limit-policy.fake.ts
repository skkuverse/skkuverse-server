import type { RequestHandler } from "express";
import { RATE_LIMIT_CLASSES, RATE_LIMITED_BODY, type Principal, type RateLimitClass, type RateLimitPolicy } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/**
 * One handler per class, which counts the requests it saw and the principal each carried when it ran, then passes
 * the request on, or answers it 429 with the public body when a test put its class in `refused`.
 */
export class FakeRateLimitPolicy implements PublicOf<RateLimitPolicy> {
  readonly counts = new Map<RateLimitClass, number>(RATE_LIMIT_CLASSES.map((limitClass) => [limitClass, 0]));
  readonly principals: Array<{ limitClass: RateLimitClass; principal: Principal | undefined }> = [];
  readonly refused = new Set<RateLimitClass>();
  private readonly handlers = new Map<RateLimitClass, RequestHandler>(
    RATE_LIMIT_CLASSES.map((limitClass) => [
      limitClass,
      (req, res, next) => {
        this.counts.set(limitClass, (this.counts.get(limitClass) ?? 0) + 1);
        this.principals.push({ limitClass, principal: req.principal });
        if (this.refused.has(limitClass)) {
          res.status(429).json(RATE_LIMITED_BODY);
          return;
        }
        next();
      },
    ]),
  );

  handlerFor(limitClass: RateLimitClass): RequestHandler {
    return this.handlers.get(limitClass)!;
  }
}
