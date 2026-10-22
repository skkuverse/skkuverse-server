import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: a platform whose table was never read is not served from a guess, so the arrivals
// route answers 503 and the tracker's tick rejects once it has written the rest (ADR 0013, D6).
export class SubwayTimetablesUnavailableError extends AppError {
  constructor(readonly keys: readonly string[]) {
    super("SUBWAY_TIMETABLES_UNAVAILABLE", `The subway timetables are unavailable: ${keys.join(", ")}`, 503);
    this.name = "SubwayTimetablesUnavailableError";
  }
}

// WHY: only a failed read of the dataset counts as unavailable; any other error is a fault in this code and reaches the filter as a 500.
export class SubwayTimetablesReadError extends Error {
  constructor(cause: unknown) {
    super(`The subway-timetables dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "SubwayTimetablesReadError";
  }
}
