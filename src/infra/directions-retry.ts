import axios from "axios";
import { DirectionsError } from "../shared/directions.error";
import type { DirectionsProvider } from "../shared/directions.types";

const AUTH_STATUSES = new Set([401, 403]);
const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT"]);

function fromAxiosError(provider: DirectionsProvider, status: number | undefined, code: string | undefined): DirectionsError {
  if (status !== undefined && AUTH_STATUSES.has(status)) {
    return new DirectionsError(provider, "auth", `authentication refused (HTTP ${status})`, status);
  }
  if (status !== undefined) return new DirectionsError(provider, "http", `HTTP ${status}`, status);
  if (code !== undefined && TIMEOUT_CODES.has(code)) return new DirectionsError(provider, "timeout", `timed out (${code})`);
  if (code === "ECONNRESET") return new DirectionsError(provider, "reset", "connection reset");
  return new DirectionsError(provider, "network", `request failed (${code ?? "no code"})`);
}

export function toDirectionsError(provider: DirectionsProvider, err: unknown): DirectionsError {
  if (err instanceof DirectionsError) return err;
  if (axios.isAxiosError(err)) return fromAxiosError(provider, err.response?.status, err.code);
  return new DirectionsError(provider, "network", err instanceof Error ? err.message : String(err));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withOneRetry<T>(provider: DirectionsProvider, call: () => Promise<T>, retryDelayMs: number): Promise<T> {
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
