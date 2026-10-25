import { AppError } from "../http/app.error";

// WHY: an answer, not a fault: with no good journey-routes read yet, the route answers 503 rather than no options (ADR 0013, D6).
export class JourneyRoutesUnavailableError extends AppError {
  constructor() {
    super("JOURNEY_ROUTES_UNAVAILABLE", "The journey routes are unavailable", 503);
    this.name = "JourneyRoutesUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class JourneyRoutesReadError extends Error {
  constructor(cause: unknown) {
    super(`The journey-routes dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "JourneyRoutesReadError";
  }
}
