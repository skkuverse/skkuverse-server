import type { DirectionsFailure, DirectionsProvider } from "./bus-eta.types";

// WHY: never wraps the original error: an AxiosError carries the request config, whose headers hold the API
// keys, and the poller registry logs whatever a tick rejects with. Only the provider, a kind and a status leave.
export class BusEtaDirectionsError extends Error {
  constructor(
    readonly provider: DirectionsProvider,
    readonly kind: DirectionsFailure,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    // WHY: the name the poller.* lines have always carried. SEE: docs/reference/logging.md ("Pollers")
    this.name = "DirectionsError";
  }

  // WHY: one retry is worth it after a timeout, a reset or a 5xx, never after an auth error.
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "reset" || (this.kind === "http" && (this.status ?? 0) >= 500);
  }
}
