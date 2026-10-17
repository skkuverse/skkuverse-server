/**
 * BusEtaTravelClient over a mocked axios and the captured response: the call it
 * sends (start, waypoints and goal as lng,lat, the keys in headers only) and
 * its one retry.
 */
import fs from "fs";
import path from "path";
import { BusEtaDirectionsError } from "../bus-eta.error";
import type { LatLng } from "../../../shared/lat-lng.types";
import { BusEtaTravelClient } from "./bus-eta-travel.client";
import type { NaverDirectionsResponse, RoutePoint } from "./bus-eta-travel.types";
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

describe("BusEtaTravelClient.fetchOffsets", () => {
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
    await expect(new BusEtaTravelClient().fetchOffsets(STOPS, CREDS)).resolves.toEqual([0, 4099, 4317]);
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
    await expect(new BusEtaTravelClient().fetchOffsets(STOPS, CREDS, { retryDelayMs: 0 })).resolves.toEqual([0, 4099, 4317]);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("Revoked key: no retry after an authentication error, and the keys never reach the message", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 401 }));

    // Act
    const err = (await new BusEtaTravelClient().fetchOffsets(STOPS, CREDS, { retryDelayMs: 0 }).catch((e: unknown) => e)) as BusEtaDirectionsError;

    // Assert
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(BusEtaDirectionsError);
    expect(err).toMatchObject({ provider: "naver", kind: "auth", status: 401 });
    expect(JSON.stringify(err) + err.message + err.stack).not.toMatch(/secret-456|key-id-123/);
  });

  it("gives up after the one retry", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 502 }));

    // Act & Assert
    await expect(new BusEtaTravelClient().fetchOffsets(STOPS, CREDS, { retryDelayMs: 0 })).rejects.toMatchObject({ kind: "http", status: 502 });
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("omits waypoints for a two-stop sequence", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 400 }));

    // Act & Assert
    await expect(new BusEtaTravelClient().fetchOffsets([STOPS[0]!, STOPS[1]!], CREDS)).rejects.toMatchObject({ kind: "http" });
    expect(mockedGet.mock.calls[0]![1].params).not.toHaveProperty("waypoints");
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});

/**
 * A synthetic forced route, never captured: start, two via points and goal on
 * a straight path north, reached at 0, 100, 700 and 820 s.
 */
const PATH: Array<[number, number]> = [
  [127.0, 37.3],
  [127.0, 37.31],
  [127.0, 37.32],
  [127.0, 37.33],
];
const FORCED_POINTS: RoutePoint[] = PATH.map(([lng, lat], k) => ({ at: { lat, lng }, kind: k === 0 || k === 3 ? "stop" : "via" }));
const FORCED_ROUTE: NaverDirectionsResponse = {
  code: 0,
  message: "ok",
  route: {
    traoptimal: [
      {
        summary: { duration: 820_000, distance: 3000 },
        path: PATH,
        guide: [
          { pointIndex: 1, type: 87, distance: 1000, duration: 100_000 },
          { pointIndex: 2, type: 87, distance: 1000, duration: 600_000 },
          { pointIndex: 3, type: 88, distance: 1000, duration: 120_000 },
        ],
      },
    ],
  },
};

describe("BusEtaTravelClient.fetchRouteTimes", () => {
  const CREDS = { keyId: "key-id-123", key: "secret-456" };
  beforeEach(() => mockedGet.mockReset());

  it("sends the via points as NAVER waypoints, lng,lat joined by |, and returns stop offsets and legs", async () => {
    // Arrange
    mockedGet.mockResolvedValue({ data: FORCED_ROUTE });

    // Act
    const times = await new BusEtaTravelClient().fetchRouteTimes(FORCED_POINTS, CREDS);

    // Assert
    expect(times).toEqual({ stopOffsetsSec: [0, 820], legsSec: [100, 600, 120] });
    const [url, opts] = mockedGet.mock.calls[0]!;
    expect(url).toBe("https://maps.apigw.ntruss.com/map-direction/v1/driving");
    expect(opts.params).toEqual({ start: "127,37.3", waypoints: "127,37.31|127,37.32", goal: "127,37.33", option: "traoptimal" });
    expect(opts.headers).toEqual({ "X-NCP-APIGW-API-KEY-ID": "key-id-123", "X-NCP-APIGW-API-KEY": "secret-456" });
  });

  it("retries once after a 5xx, as the stops-only call does", async () => {
    // Arrange
    const err = new axios.AxiosError("boom");
    (err as { response?: unknown }).response = { status: 503 };
    mockedGet.mockRejectedValueOnce(err).mockResolvedValueOnce({ data: FORCED_ROUTE });

    // Act & Assert
    await expect(new BusEtaTravelClient().fetchRouteTimes(FORCED_POINTS, CREDS, { retryDelayMs: 0 })).resolves.toMatchObject({ stopOffsetsSec: [0, 820] });
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it.each([
    [5, 1],
    [6, 0],
  ])("NAVER takes at most 5 waypoints: a route with %i points between its ends makes %i calls", async (between, calls) => {
    // Arrange
    mockedGet.mockResolvedValue({ data: FORCED_ROUTE });
    const via: RoutePoint = { at: { lat: 37.31, lng: 127.0 }, kind: "via" };
    const points = [FORCED_POINTS[0]!, ...Array.from({ length: between }, () => via), FORCED_POINTS[3]!];

    // Act
    await new BusEtaTravelClient().fetchRouteTimes(points, CREDS).catch((e: unknown) => e);

    // Assert
    expect(mockedGet).toHaveBeenCalledTimes(calls);
  });
});
