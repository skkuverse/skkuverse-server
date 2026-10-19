import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no good layout read yet, /ui/home is a 503 rather than an empty or committed one.
export class UiHomeLayoutUnavailableError extends AppError {
  constructor() {
    super("HOME_LAYOUT_UNAVAILABLE", "The home layout is unavailable", 503);
    this.name = "UiHomeLayoutUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class UiHomeLayoutReadError extends Error {
  constructor(cause: unknown) {
    super(`The home layout dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "UiHomeLayoutReadError";
  }
}
