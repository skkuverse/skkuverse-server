import axios from "axios";
import { BusEtaDirectionsError } from "./bus-eta.error";
import type { DirectionsProvider } from "./bus-eta.types";

const AUTH_STATUSES = new Set([401, 403]);
const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT"]);

// WHY: the directions clients and the probe's position client extend this for their one retry and its error
// translation, so a NAVER, TMAP or TOPIS failure leaves as a BusEtaDirectionsError that carries no request config.
export class BusEtaClient {
  protected async fetchWithOneRetry<T>(provider: DirectionsProvider, call: () => Promise<T>, retryDelayMs: number): Promise<T> {
    try {
      return await call();
    } catch (first: unknown) {
      const err = this.toDirectionsError(provider, first);
      if (!err.retryable) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      try {
        return await call();
      } catch (second: unknown) {
        throw this.toDirectionsError(provider, second);
      }
    }
  }

  private toDirectionsError(provider: DirectionsProvider, err: unknown): BusEtaDirectionsError {
    if (err instanceof BusEtaDirectionsError) return err;
    if (axios.isAxiosError(err)) return this.fromAxiosError(provider, err.response?.status, err.code);
    return new BusEtaDirectionsError(provider, "network", err instanceof Error ? err.message : String(err));
  }

  private fromAxiosError(provider: DirectionsProvider, status: number | undefined, code: string | undefined): BusEtaDirectionsError {
    if (status !== undefined && AUTH_STATUSES.has(status)) {
      return new BusEtaDirectionsError(provider, "auth", `authentication refused (HTTP ${status})`, status);
    }
    if (status !== undefined) return new BusEtaDirectionsError(provider, "http", `HTTP ${status}`, status);
    if (code !== undefined && TIMEOUT_CODES.has(code)) return new BusEtaDirectionsError(provider, "timeout", `timed out (${code})`);
    if (code === "ECONNRESET") return new BusEtaDirectionsError(provider, "reset", "connection reset");
    return new BusEtaDirectionsError(provider, "network", `request failed (${code ?? "no code"})`);
  }
}
