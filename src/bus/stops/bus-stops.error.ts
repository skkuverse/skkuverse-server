import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no good stops read yet, a 200 without the shuttle groups would replace the app's
// cached config with a wrong one, while a 503 keeps the last good one (unify-bus-stops design D5).
export class BusStopsUnavailableError extends AppError {
  constructor() {
    super("BUS_STOPS_UNAVAILABLE", "The bus stops are unavailable", 503);
    this.name = "BusStopsUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class BusStopsReadError extends Error {
  constructor(cause: unknown) {
    super(`The bus-stops dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "BusStopsReadError";
  }
}
