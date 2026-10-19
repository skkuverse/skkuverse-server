import { AppError } from "../../http/app.error";

// WHY: an answer, not a fault: with no good layout read yet, /ui/home is a 503 rather than an empty or committed one.
export class UiHomeLayoutUnavailableError extends AppError {
  constructor() {
    super("HOME_LAYOUT_UNAVAILABLE", "The home layout is unavailable", 503);
    this.name = "UiHomeLayoutUnavailableError";
  }
}
