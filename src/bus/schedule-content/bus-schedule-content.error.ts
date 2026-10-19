import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no good schedule content read yet, a timetable would serve runs that do not operate.
export class BusScheduleContentUnavailableError extends AppError {
  constructor() {
    super("BUS_SCHEDULE_UNAVAILABLE", "The shuttle schedules are unavailable", 503);
    this.name = "BusScheduleContentUnavailableError";
  }
}

// WHY: only a failed read of a dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class BusScheduleContentReadError extends Error {
  constructor(dataset: string, cause: unknown) {
    super(`The ${dataset} dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "BusScheduleContentReadError";
  }
}
