import { AppError } from "../../http/app.error";

// WHY: the loader's answer with no good line ever read; the map catches it and serves the Jongno lines without the
// HSSC line (ADR 0013, D6), so no route answers it today.
export class BusHsscRouteLineUnavailableError extends AppError {
  constructor() {
    super("HSSC_ROUTE_LINE_UNAVAILABLE", "The HSSC route line is unavailable", 503);
    this.name = "BusHsscRouteLineUnavailableError";
  }
}

// WHY: only a failed read of the dataset counts as the line being unreadable; any other error is a fault in this code.
export class BusHsscRouteLineReadError extends Error {
  constructor(cause: unknown) {
    super(`The hssc-route-line dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "BusHsscRouteLineReadError";
  }
}
