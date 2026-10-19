import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no good banners read yet, /ui/home/campus is a 503 rather than an empty sheet.
export class UiCampusBannersUnavailableError extends AppError {
  constructor() {
    super("CAMPUS_BANNERS_UNAVAILABLE", "The campus banners are unavailable", 503);
    this.name = "UiCampusBannersUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class UiCampusBannersReadError extends Error {
  constructor(cause: unknown) {
    super(`The campus banners dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "UiCampusBannersReadError";
  }
}
