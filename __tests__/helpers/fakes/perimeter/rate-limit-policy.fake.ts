import type { RequestHandler } from "express";
import { RATE_LIMIT_CLASSES, type RateLimitClass, type RateLimitPolicy } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Passes every request on, one handler per class, and counts the requests each class saw. */
export class FakeRateLimitPolicy implements PublicOf<RateLimitPolicy> {
  readonly counts = new Map<RateLimitClass, number>(RATE_LIMIT_CLASSES.map((limitClass) => [limitClass, 0]));
  private readonly handlers = new Map<RateLimitClass, RequestHandler>(
    RATE_LIMIT_CLASSES.map((limitClass) => [
      limitClass,
      (_req, _res, next) => {
        this.counts.set(limitClass, (this.counts.get(limitClass) ?? 0) + 1);
        next();
      },
    ]),
  );

  handlerFor(limitClass: RateLimitClass): RequestHandler {
    return this.handlers.get(limitClass)!;
  }
}
