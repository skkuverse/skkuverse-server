import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no line read yet, the overlay route renders it as a 503 rather than an empty map.
export class BusRoutePathUnavailableError extends AppError {
  constructor() {
    super("JONGRO_ROUTE_PATHS_UNAVAILABLE", "The Jongno route lines are unavailable", 503);
    this.name = "BusRoutePathUnavailableError";
  }
}
