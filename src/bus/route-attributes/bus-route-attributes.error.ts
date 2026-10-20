import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no good attributes read yet, a route that serves them is a 503 rather than cards
// without colors or crowding against no seat count (move-reference-datasets D10).
export class BusRouteAttributesUnavailableError extends AppError {
  constructor() {
    super("JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE", "The Jongro route attributes are unavailable", 503);
    this.name = "BusRouteAttributesUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class BusRouteAttributesReadError extends Error {
  constructor(cause: unknown) {
    super(`The jongro-route-attributes dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "BusRouteAttributesReadError";
  }
}
