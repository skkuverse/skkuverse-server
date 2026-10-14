/**
 * BusEtaLiveClient over a mocked axios and the captured response: the call it
 * sends (start, waypoints and goal as lng,lat, the keys in headers only) and
 * its one retry.
 */
import fs from "fs";
import path from "path";
import { DirectionsError } from "../../../shared/directions.error";
import type { LatLng } from "../../../shared/lat-lng.types";
import { BusEtaLiveClient } from "./bus-eta-live.client";
import type { NaverDirectionsResponse } from "./bus-eta-live.types";
import axios from "axios";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, get: jest.fn() }, isAxiosError: actual.isAxiosError };
});
const mockedGet = axios.get as jest.Mock;

const FIXTURE: NaverDirectionsResponse = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../../__tests__/nest/bus/fixtures/naver-directions-inja.json"), "utf8"),
);
// Student center bus lot → N Center → Welfare Hall
const STOPS: LatLng[] = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
  { lat: 37.293999, lng: 126.973183 },
];

const fixture = (): NaverDirectionsResponse => JSON.parse(JSON.stringify(FIXTURE));

describe("BusEtaLiveClient.fetchOffsets", () => {
  const CREDS = { keyId: "key-id-123", key: "secret-456" };
  beforeEach(() => mockedGet.mockReset());

  const axiosError = (fields: { status?: number; code?: string }) => {
    const err = new axios.AxiosError("boom", fields.code);
    if (fields.status) (err as { response?: unknown }).response = { status: fields.status };
    return err;
  };

  it("sends start, waypoints and goal as lng,lat, with the keys in headers only", async () => {
    // Arrange
    mockedGet.mockResolvedValue({ data: fixture() });

    // Act & Assert
    await expect(new BusEtaLiveClient().fetchOffsets(STOPS, CREDS)).resolves.toEqual([0, 4099, 4317]);
    const [url, opts] = mockedGet.mock.calls[0]!;
    expect(url).toBe("https://maps.apigw.ntruss.com/map-direction/v1/driving");
    expect(opts.params).toEqual({
      start: "126.993643,37.587367",
      waypoints: "126.975057,37.292298",
      goal: "126.973183,37.293999",
      option: "traoptimal",
    });
    expect(opts.headers).toEqual({ "X-NCP-APIGW-API-KEY-ID": "key-id-123", "X-NCP-APIGW-API-KEY": "secret-456" });
    expect(opts.timeout).toBe(5_000);
    expect(JSON.stringify(opts.params)).not.toContain("secret");
  });

  it.each([
    ["a timeout", { code: "ECONNABORTED" }],
    ["a reset", { code: "ECONNRESET" }],
    ["a 5xx", { status: 503 }],
  ])("retries once after %s", async (_label, fields) => {
    // Arrange
    mockedGet.mockRejectedValueOnce(axiosError(fields)).mockResolvedValueOnce({ data: fixture() });

    // Act & Assert
    await expect(new BusEtaLiveClient().fetchOffsets(STOPS, CREDS, { retryDelayMs: 0 })).resolves.toEqual([0, 4099, 4317]);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("Revoked key: no retry after an authentication error, and the keys never reach the message", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 401 }));

    // Act
    const err = (await new BusEtaLiveClient().fetchOffsets(STOPS, CREDS, { retryDelayMs: 0 }).catch((e: unknown) => e)) as DirectionsError;

    // Assert
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(DirectionsError);
    expect(err).toMatchObject({ provider: "naver", kind: "auth", status: 401 });
    expect(JSON.stringify(err) + err.message + err.stack).not.toMatch(/secret-456|key-id-123/);
  });

  it("gives up after the one retry", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 502 }));

    // Act & Assert
    await expect(new BusEtaLiveClient().fetchOffsets(STOPS, CREDS, { retryDelayMs: 0 })).rejects.toMatchObject({ kind: "http", status: 502 });
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("omits waypoints for a two-stop sequence", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 400 }));

    // Act & Assert
    await expect(new BusEtaLiveClient().fetchOffsets([STOPS[0]!, STOPS[1]!], CREDS)).rejects.toMatchObject({ kind: "http" });
    expect(mockedGet.mock.calls[0]![1].params).not.toHaveProperty("waypoints");
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
