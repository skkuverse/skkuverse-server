/**
 * The TMAP 타임머신 client and its per-stop parser, over a synthetic response
 * shaped after the live probe of 2026-10-09 (tasks.md 9.1; TMAP's terms forbid
 * keeping real responses past 24 h), the rejection cases of spec "Implausible
 * routes are rejected", and the 24-hour life of a baseline built from it.
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import {
  fetchTmapOffsets,
  parseTmapOffsets,
  type TmapPredictionResponse,
} from "../../../src/bus/eta/tmap-prediction";
import { DirectionsError } from "../../../src/bus/eta/directions-error";
import { baselineDoc } from "../../../src/bus/eta/eta-store";
import type { LatLng } from "../../../src/bus/types";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, post: jest.fn() }, isAxiosError: actual.isAxiosError };
});
const mockedPost = axios.post as jest.Mock;

const FIXTURE: TmapPredictionResponse = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/tmap-prediction-inja.json"), "utf8"),
);
// 학생회관 버스 주차장 → N센터 앞 → 복지회관 앞
const STOPS: LatLng[] = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
  { lat: 37.293999, lng: 126.973183 },
];
const OFFSETS = [0, 4500, 4620];

const fixture = (): TmapPredictionResponse => JSON.parse(JSON.stringify(FIXTURE));
const features = (res: TmapPredictionResponse) => res.features!;

function rejection(fn: () => unknown): DirectionsError {
  try {
    fn();
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(DirectionsError);
    return err as DirectionsError;
  }
  throw new Error("expected a DirectionsError");
}

describe("parseTmapOffsets", () => {
  it("reads the travel time to each stop from the running segment times, ignoring the waypoint echo after E", () => {
    expect(features(fixture()).at(-1)!.properties).toEqual({ name: "", pointType: "B1" });
    expect(parseTmapOffsets(fixture(), STOPS)).toEqual(OFFSETS);
  });

  it("rejects a wrong count of waypoint (B1…) points", () => {
    const res = fixture();
    res.features = features(res).filter((f) => !(f.properties.pointType === "B1" && f.properties.index !== undefined));
    const err = rejection(() => parseTmapOffsets(res, STOPS));
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/expected 1 waypoint \(B1…\) and 1 end \(E\) points, got 0 and 1/);
  });

  it("rejects a route without an end (E) point", () => {
    const res = fixture();
    res.features = features(res).filter((f) => f.properties.pointType !== "E");
    expect(rejection(() => parseTmapOffsets(res, STOPS)).message).toMatch(/got 1 and 0/);
  });

  it("rejects stop times that miss the route total by more than 30 s", () => {
    const res = fixture();
    features(res)[0]!.properties.totalTime = 4620 + 31;
    expect(rejection(() => parseTmapOffsets(res, STOPS)).message).toMatch(/add up to 4620 s but the route total is 4651 s/);
    const close = fixture();
    features(close)[0]!.properties.totalTime = 4620 + 29;
    expect(parseTmapOffsets(close, STOPS)).toEqual(OFFSETS);
  });

  it("Drop-off snapped to an outside road: rejects a stop more than 150 m from where the route places it", () => {
    const moved = [...STOPS];
    moved[1] = { lat: 37.292298 - 0.00225, lng: 126.975057 }; // about 250 m south
    const err = rejection(() => parseTmapOffsets(fixture(), moved));
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/stop 1 is 2\d\d m from where the route places it/);
  });

  it("rejects offsets that go backwards", () => {
    const res = fixture();
    const last = features(res).findIndex((f) => f.properties.pointType === "E") - 1;
    features(res)[last]!.properties.time = -300;
    features(res)[0]!.properties.totalTime = 4200;
    expect(rejection(() => parseTmapOffsets(res, STOPS)).message).toMatch(/stop 2 is reached before stop 1/);
  });

  it("reports a response without a route as an API failure", () => {
    const err = rejection(() => parseTmapOffsets({ type: "FeatureCollection", features: [] }, STOPS));
    expect(err.kind).toBe("api");
    expect(err.retryable).toBe(false);
  });

  it("Prediction expires after 24 hours: a baseline from it is a TMAP value that lives 24 h", () => {
    const fetchedAt = new Date("2026-10-11T19:00:00Z"); // 04:00 KST
    const run = {
      serviceId: "campus-inja",
      routeType: "regular",
      date: "2026-10-12",
      time: "10:00",
      departAt: new Date("2026-10-12T01:00:00Z"),
    };
    const doc = baselineDoc(run, parseTmapOffsets(fixture(), STOPS), fetchedAt);
    expect(doc).toMatchObject({ source: "tmap", kind: "baseline", offsetsSec: OFFSETS });
    expect(doc.expiresAt.getTime() - fetchedAt.getTime()).toBe(24 * 3600_000);
  });
});

describe("fetchTmapOffsets", () => {
  const KEY = "app-key-secret-789";
  const DEPART = new Date("2026-10-12T01:00:00Z"); // 10:00 KST
  beforeEach(() => mockedPost.mockReset());

  const axiosError = (fields: { status?: number; code?: string }) => {
    const err = new axios.AxiosError("boom", fields.code);
    if (fields.status) (err as { response?: unknown }).response = { status: fields.status };
    return err;
  };

  it("asks for an arrival forecast from the KST departure time, with the app key in a header only", async () => {
    mockedPost.mockResolvedValue({ data: fixture() });
    await expect(fetchTmapOffsets(STOPS, DEPART, KEY)).resolves.toEqual(OFFSETS);
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
    mockedPost.mockRejectedValueOnce(axiosError(fields)).mockResolvedValueOnce({ data: fixture() });
    await expect(fetchTmapOffsets(STOPS, DEPART, KEY, { retryDelayMs: 0 })).resolves.toEqual(OFFSETS);
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it("Revoked key: no retry after an authentication error, and the key never reaches the message", async () => {
    mockedPost.mockRejectedValue(axiosError({ status: 403 }));
    const err = (await fetchTmapOffsets(STOPS, DEPART, KEY, { retryDelayMs: 0 }).catch((e: unknown) => e)) as DirectionsError;
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(DirectionsError);
    expect(err).toMatchObject({ provider: "tmap", kind: "auth", status: 403 });
    expect(JSON.stringify(err) + err.message + err.stack).not.toContain(KEY);
  });

  it("does not retry a quota refusal (429)", async () => {
    mockedPost.mockRejectedValue(axiosError({ status: 429 }));
    await expect(fetchTmapOffsets(STOPS, DEPART, KEY, { retryDelayMs: 0 })).rejects.toMatchObject({ kind: "http", status: 429 });
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it("omits wayPoints for a two-stop sequence", async () => {
    mockedPost.mockRejectedValue(axiosError({ status: 400 }));
    await expect(fetchTmapOffsets([STOPS[0]!, STOPS[1]!], DEPART, KEY)).rejects.toMatchObject({ kind: "http" });
    expect(mockedPost.mock.calls[0]![1].routesInfo).not.toHaveProperty("wayPoints");
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
