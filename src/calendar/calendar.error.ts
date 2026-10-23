import { AppError } from "../http/app.error";

// WHY: an answer, not a fault: with no good school rest days read yet, a day cannot be told a rest day; a feature
// that answers riders with it maps this 503 to its own.
export class CalendarUnavailableError extends AppError {
  constructor() {
    super("CALENDAR_UNAVAILABLE", "The school calendar is unavailable", 503);
    this.name = "CalendarUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class CalendarReadError extends Error {
  constructor(dataset: string, cause: unknown) {
    super(`The ${dataset} dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "CalendarReadError";
  }
}
