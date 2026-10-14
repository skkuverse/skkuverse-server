import type { DirectionsFailure, DirectionsProvider } from "./directions.types";

// WHY: never wraps the original error: an AxiosError carries the request config, whose headers hold the API
// keys, and the poller registry logs whatever a tick rejects with. Only the provider, a kind and a status leave.
export class DirectionsError extends Error {
  constructor(
    readonly provider: DirectionsProvider,
    readonly kind: DirectionsFailure,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = "DirectionsError";
  }

  // WHY: one retry is worth it after a timeout, a reset or a 5xx, never after an auth error.
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "reset" || (this.kind === "http" && (this.status ?? 0) >= 500);
  }
}
