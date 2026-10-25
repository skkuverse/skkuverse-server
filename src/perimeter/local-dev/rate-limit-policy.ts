import type { RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { RATE_LIMITED_BODY, RateLimitPolicy, type PerimeterDeps, type RateLimitClass } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

// WHY: one per-IP limit, high enough for one developer's screens, which all share the loopback address; it always
// applies, so a local run answers 429 as a deployed one does.
const LOCAL_DEV_REQUESTS_PER_MINUTE = 300;

function perIpRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: LOCAL_DEV_REQUESTS_PER_MINUTE,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
    standardHeaders: true,
    legacyHeaders: false,
    message: RATE_LIMITED_BODY,
  });
}

// WHY: a limiter per class, so a route bound to two classes counts once in each, not twice in one.
export class LocalDevRateLimitPolicy extends RateLimitPolicy {
  private readonly handlers: Readonly<Record<RateLimitClass, RequestHandler>> = {
    general: perIpRateLimit(),
    notices: perIpRateLimit(),
    "notices-overview": perIpRateLimit(),
  };

  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "rateLimitPolicy");
  }

  handlerFor(limitClass: RateLimitClass): RequestHandler {
    return this.handlers[limitClass];
  }
}
