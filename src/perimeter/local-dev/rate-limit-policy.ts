import type { RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { skipWhenRateLimitOff } from "../../infra/rate-limit-keys";
import { RATE_LIMITED_BODY, RateLimitPolicy, type PerimeterDeps } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

// WHY: one limit for every class, high enough for a developer's own screens. Development defaults RATE_LIMIT=off,
// which skips it: run `npm run dev` with RATE_LIMIT=on to see a 429.
const LOCAL_DEV_REQUESTS_PER_MINUTE = 300;

export class LocalDevRateLimitPolicy extends RateLimitPolicy {
  private readonly limiter: RequestHandler = rateLimit({
    windowMs: 60 * 1000,
    limit: LOCAL_DEV_REQUESTS_PER_MINUTE,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
    skip: skipWhenRateLimitOff,
    standardHeaders: true,
    legacyHeaders: false,
    message: RATE_LIMITED_BODY,
  });

  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "rateLimitPolicy");
  }

  handlerFor(): RequestHandler {
    return this.limiter;
  }
}
