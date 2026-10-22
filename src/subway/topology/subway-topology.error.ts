import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no good topology read yet, the arrivals route answers 503 rather than directions
// without names or stops away (ADR 0013, D6).
export class SubwayTopologyUnavailableError extends AppError {
  constructor() {
    super("SUBWAY_TOPOLOGY_UNAVAILABLE", "The subway topology is unavailable", 503);
    this.name = "SubwayTopologyUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class SubwayTopologyReadError extends Error {
  constructor(cause: unknown) {
    super(`The subway-topology dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "SubwayTopologyReadError";
  }
}
