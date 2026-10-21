import { AppError } from "../http/app.error";

// WHY: an answer, not a fault: with no good registry read yet, a route that needs it is a 503 rather than an empty
// list, so a client keeps the copy it cached instead of reading every game as unlisted.
export class GamesRegistryUnavailableError extends AppError {
  constructor() {
    super("GAME_REGISTRY_UNAVAILABLE", "The game registry is unavailable", 503);
    this.name = "GamesRegistryUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class GamesRegistryReadError extends Error {
  constructor(cause: unknown) {
    super(`The games dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "GamesRegistryReadError";
  }
}
