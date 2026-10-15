/**
 * BusEtaClient, the base of the two directions clients: one retry after a
 * timeout, a reset or a 5xx, none after an authentication error, and every
 * failure leaving as a BusEtaDirectionsError with the provider, a kind and a
 * status, never the axios error that holds the request config.
 */
import axios from "axios";
import { BusEtaClient } from "./bus-eta.client";
import { BusEtaDirectionsError } from "./bus-eta.error";

class RetryingClient extends BusEtaClient {
  fetchOnce<T>(call: () => Promise<T>): Promise<T> {
    return this.fetchWithOneRetry("naver", call, 0);
  }
}

const axiosError = (fields: { status?: number; code?: string }) => {
  const err = new axios.AxiosError("boom", fields.code);
  if (fields.status) (err as { response?: unknown }).response = { status: fields.status };
  return err;
};

async function failureOf(call: () => Promise<unknown>): Promise<BusEtaDirectionsError> {
  const err = await new RetryingClient().fetchOnce(call).catch((e: unknown) => e);
  if (!(err instanceof BusEtaDirectionsError)) throw new Error("expected a BusEtaDirectionsError");
  return err;
}

describe("BusEtaClient", () => {
  it.each([
    ["a timeout", { code: "ECONNABORTED" }],
    ["a reset", { code: "ECONNRESET" }],
    ["a 5xx", { status: 503 }],
  ])("retries once after %s", async (_name, fields) => {
    // Arrange
    const call = jest.fn().mockRejectedValueOnce(axiosError(fields)).mockResolvedValueOnce("ok");

    // Act
    const result = await new RetryingClient().fetchOnce(call);

    // Assert
    expect(result).toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ status: 401 }, { kind: "auth", status: 401 }],
    [{ status: 403 }, { kind: "auth", status: 403 }],
    [{ status: 429 }, { kind: "http", status: 429 }],
    [{ code: "ENOTFOUND" }, { kind: "network", status: undefined }],
  ])("does not retry %j and reports it as %j", async (fields, expected) => {
    // Arrange
    const call = jest.fn().mockRejectedValue(axiosError(fields));

    // Act
    const err = await failureOf(call);

    // Assert
    expect({ kind: err.kind, status: err.status }).toEqual(expected);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("reports the second failure after a retry, as the provider's", async () => {
    // Arrange
    const call = jest.fn().mockRejectedValueOnce(axiosError({ code: "ETIMEDOUT" })).mockRejectedValueOnce(axiosError({ status: 502 }));

    // Act
    const err = await failureOf(call);

    // Assert
    expect({ provider: err.provider, kind: err.kind, status: err.status, name: err.name }).toEqual({
      provider: "naver",
      kind: "http",
      status: 502,
      name: "DirectionsError",
    });
  });

  it("keeps a BusEtaDirectionsError a call throws itself, and wraps nothing else in it", async () => {
    // Arrange
    const implausible = new BusEtaDirectionsError("naver", "implausible", "no route");

    // Act
    const kept = await failureOf(() => Promise.reject(implausible));
    const plain = await failureOf(() => Promise.reject(new Error("socket hang up")));

    // Assert
    expect(kept).toBe(implausible);
    expect({ kind: plain.kind, message: plain.message }).toEqual({ kind: "network", message: "naver: socket hang up" });
    expect(plain).not.toHaveProperty("cause");
  });
});
