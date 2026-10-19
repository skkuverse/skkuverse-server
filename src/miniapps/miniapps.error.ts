import { AppError } from "../http/app.error";

// WHY: an answer, not a fault: with no good registry read yet, a route that needs it is a 503 rather than an empty registry.
export class MiniappsRegistryUnavailableError extends AppError {
  constructor() {
    super("MINIAPP_REGISTRY_UNAVAILABLE", "The mini app registry is unavailable", 503);
    this.name = "MiniappsRegistryUnavailableError";
  }
}

// WHY: only a failed read of the dataset answers 503; any other error is a fault in this code and reaches the filter as a 500.
export class MiniappsRegistryReadError extends Error {
  constructor(cause: unknown) {
    super(`The mini app registry dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "MiniappsRegistryReadError";
  }
}
