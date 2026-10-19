import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no good layout read yet, /ui/home/transit is a 503 rather than an empty or committed one.
export class UiTransitLayoutUnavailableError extends AppError {
  constructor() {
    super("TRANSIT_LAYOUT_UNAVAILABLE", "The transit layout is unavailable", 503);
    this.name = "UiTransitLayoutUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class UiTransitLayoutReadError extends Error {
  constructor(cause: unknown) {
    super(`The transit layout dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "UiTransitLayoutReadError";
  }
}
