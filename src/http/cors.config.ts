import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";
import logger from "../infra/logger";
import { createLogThrottle } from "../shared/log-throttle.util";
import type { OriginTrust } from "../perimeter/perimeter.ports";

// WHY: read-only, so a browser at an allowed origin never gets past a preflight to POST /internal/*.
export const CORS_METHODS = ["GET", "HEAD", "OPTIONS"] as const;

// QUIRK(cors): `ETag` is not CORS-safelisted, so a browser client can read it to revalidate only once
// it is exposed.
export const EXPOSED_RESPONSE_HEADERS = "ETag";

const failedThrottle = createLogThrottle(60_000);

function logFailure(err: unknown): void {
  const ticket = failedThrottle.take("origin-trust");
  if (ticket) logger.error({ event: "http.cors.origin_trust_failed", err, suppressed: ticket.suppressed }, "ORIGIN_TRUST failed; the origin is refused");
}

// QUIRK(cors): an array answer keeps `Vary: Origin` on every response, a refusal included; `false` would drop it,
// and a shared cache could then serve one origin's answer to another.
function trustedOrigins(originTrust: OriginTrust, origin: string | undefined): string[] {
  if (origin === undefined) return [];
  try {
    return originTrust.isCorsOrigin(origin) ? [origin] : [];
  } catch (err: unknown) {
    logFailure(err);
    return [];
  }
}

export function corsOptions(originTrust: OriginTrust): CorsOptions {
  return {
    origin: (origin, done) => done(null, trustedOrigins(originTrust, origin)),
    methods: [...CORS_METHODS],
    exposedHeaders: EXPOSED_RESPONSE_HEADERS,
    credentials: false,
    maxAge: 86400,
  };
}
