import axios from "axios";

/**
 * Failures of a directions call (NAVER Directions 5, TMAP), as one error type
 * the estimate pollers can reject with.
 *
 * Never wraps the original error: an AxiosError carries the request config,
 * whose headers hold the API keys, and the poller registry logs whatever a
 * tick rejects with. Only the provider, a kind and a status leave this module.
 */
export type DirectionsProvider = "naver" | "tmap";

export type DirectionsFailure =
  | "auth" // 401/403: a revoked or wrong key; retrying cannot help
  | "http" // any other HTTP error status
  | "timeout"
  | "reset" // the connection was reset
  | "network" // DNS, refused, and other transport failures
  | "api" // HTTP 200 whose body reports a failure
  | "implausible"; // a route that fails the checks of spec "Implausible routes are rejected"

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

  /** One retry is worth it after a timeout, a reset or a 5xx — never after an auth error. */
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "reset" || (this.kind === "http" && (this.status ?? 0) >= 500);
  }
}

export function toDirectionsError(provider: DirectionsProvider, err: unknown): DirectionsError {
  if (err instanceof DirectionsError) return err;
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      return new DirectionsError(provider, "auth", `authentication refused (HTTP ${status})`, status);
    }
    if (status !== undefined) return new DirectionsError(provider, "http", `HTTP ${status}`, status);
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      return new DirectionsError(provider, "timeout", `timed out (${err.code})`);
    }
    if (err.code === "ECONNRESET") return new DirectionsError(provider, "reset", "connection reset");
    return new DirectionsError(provider, "network", `request failed (${err.code ?? "no code"})`);
  }
  return new DirectionsError(provider, "network", err instanceof Error ? err.message : String(err));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `call`, and once more after `retryDelayMs` if the first failure is retryable. */
export async function withOneRetry<T>(
  provider: DirectionsProvider,
  call: () => Promise<T>,
  retryDelayMs: number,
): Promise<T> {
  try {
    return await call();
  } catch (first: unknown) {
    const err = toDirectionsError(provider, first);
    if (!err.retryable) throw err;
    await sleep(retryDelayMs);
    try {
      return await call();
    } catch (second: unknown) {
      throw toDirectionsError(provider, second);
    }
  }
}
