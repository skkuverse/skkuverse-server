/**
 * BusEtaBaselineClient over a mocked axios: the forecast request it sends (an
 * arrival forecast from the KST departure, the app key in a header only) and
 * its one retry.
 */
import fs from "fs";
import path from "path";
import { BusEtaDirectionsError } from "../bus-eta.error";
import type { LatLng } from "../../../shared/lat-lng.types";
import { BusEtaBaselineClient } from "./bus-eta-baseline.client";
import type { TmapPredictionResponse } from "./bus-eta-baseline.types";
import axios from "axios";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, post: jest.fn() }, isAxiosError: actual.isAxiosError };
});
const mockedPost = axios.post as jest.Mock;

const FIXTURE: TmapPredictionResponse = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../../__tests__/nest/bus/fixtures/tmap-prediction-inja.json"), "utf8"),
);
// Student center bus lot → N Center → Welfare Hall
const STOPS: LatLng[] = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
  { lat: 37.293999, lng: 126.973183 },
];
const OFFSETS = [0, 4500, 4620];

const fixture = (): TmapPredictionResponse => JSON.parse(JSON.stringify(FIXTURE));

describe("BusEtaBaselineClient.fetchOffsets", () => {
  const KEY = "app-key-secret-789";
  const DEPART = new Date("2026-10-12T01:00:00Z"); // 10:00 KST
  beforeEach(() => mockedPost.mockReset());

  const axiosError = (fields: { status?: number; code?: string }) => {
    const err = new axios.AxiosError("boom", fields.code);
    if (fields.status) (err as { response?: unknown }).response = { status: fields.status };
    return err;
  };

  it("asks for an arrival forecast from the KST departure time, with the app key in a header only", async () => {
    // Arrange
    mockedPost.mockResolvedValue({ data: fixture() });

    // Act & Assert
    await expect(new BusEtaBaselineClient().fetchOffsets(STOPS, DEPART, { appKey: KEY })).resolves.toEqual(OFFSETS);
    const [url, body, opts] = mockedPost.mock.calls[0]!;
    expect(url).toBe("https://apis.openapi.sk.com/tmap/routes/prediction");
    expect(body).toEqual({
      routesInfo: {
        departure: { name: "stop0", lon: "126.993643", lat: "37.587367" },
        destination: { name: "stop2", lon: "126.973183", lat: "37.293999" },
        predictionType: "arrival",
        predictionTime: "2026-10-12T10:00:00+0900",
        searchOption: "00",
        trafficInfo: "N",
        wayPoints: { wayPoint: [{ lon: "126.975057", lat: "37.292298" }] },
      },
    });
    expect(opts.params).toEqual({ version: 1, reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO", sort: "index", totalValue: 1 });
    expect(opts.headers).toEqual({ appKey: KEY, Accept: "application/json", "Content-Type": "application/json" });
    expect(opts.timeout).toBe(5_000);
    expect(JSON.stringify([url, body, opts.params])).not.toContain("secret");
  });

  it.each([
    ["a timeout", { code: "ECONNABORTED" }],
    ["a reset", { code: "ECONNRESET" }],
    ["a 5xx", { status: 503 }],
  ])("retries once after %s", async (_label, fields) => {
    // Arrange
    mockedPost.mockRejectedValueOnce(axiosError(fields)).mockResolvedValueOnce({ data: fixture() });

    // Act & Assert
    await expect(new BusEtaBaselineClient().fetchOffsets(STOPS, DEPART, { appKey: KEY, retryDelayMs: 0 })).resolves.toEqual(OFFSETS);
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it("Revoked key: no retry after an authentication error, and the key never reaches the message", async () => {
    // Arrange
    mockedPost.mockRejectedValue(axiosError({ status: 403 }));

    // Act
    const err = (await new BusEtaBaselineClient().fetchOffsets(STOPS, DEPART, { appKey: KEY, retryDelayMs: 0 }).catch((e: unknown) => e)) as BusEtaDirectionsError;

    // Assert
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(BusEtaDirectionsError);
    expect(err).toMatchObject({ provider: "tmap", kind: "auth", status: 403 });
    expect(JSON.stringify(err) + err.message + err.stack).not.toContain(KEY);
  });

  it("does not retry a quota refusal (429)", async () => {
    // Arrange
    mockedPost.mockRejectedValue(axiosError({ status: 429 }));

    // Act & Assert
    await expect(new BusEtaBaselineClient().fetchOffsets(STOPS, DEPART, { appKey: KEY, retryDelayMs: 0 })).rejects.toMatchObject({ kind: "http", status: 429 });
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it("omits wayPoints for a two-stop sequence", async () => {
    // Arrange
    mockedPost.mockRejectedValue(axiosError({ status: 400 }));

    // Act & Assert
    await expect(new BusEtaBaselineClient().fetchOffsets([STOPS[0]!, STOPS[1]!], DEPART, { appKey: KEY })).rejects.toMatchObject({ kind: "http" });
    expect(mockedPost.mock.calls[0]![1].routesInfo).not.toHaveProperty("wayPoints");
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
