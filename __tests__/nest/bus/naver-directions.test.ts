/**
 * The NAVER Directions 5 client and its per-stop parser, over the live
 * response captured on 2026-10-09 (tasks.md 9.1) for campus-inja.regular, and
 * the rejection cases of spec "Implausible routes are rejected".
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import {
  fetchNaverOffsets,
  parseNaverOffsets,
  type NaverDirectionsResponse,
} from "../../../src/bus/eta/naver-directions";
import { DirectionsError } from "../../../src/bus/eta/directions-error";
import type { LatLng } from "../../../src/bus/types";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, get: jest.fn() }, isAxiosError: actual.isAxiosError };
});
const mockedGet = axios.get as jest.Mock;

const FIXTURE: NaverDirectionsResponse = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/naver-directions-inja.json"), "utf8"),
);
// 학생회관 버스 주차장 → N센터 앞 → 복지회관 앞
const STOPS: LatLng[] = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
  { lat: 37.293999, lng: 126.973183 },
];

const fixture = (): NaverDirectionsResponse => JSON.parse(JSON.stringify(FIXTURE));
const route = (res: NaverDirectionsResponse) => res.route!.traoptimal![0]!;

function rejection(fn: () => unknown): DirectionsError {
  try {
    fn();
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(DirectionsError);
    return err as DirectionsError;
  }
  throw new Error("expected a DirectionsError");
}

describe("parseNaverOffsets", () => {
  it("reads the travel time to each stop from the running guide sums", () => {
    expect(parseNaverOffsets(fixture(), STOPS)).toEqual([0, 4099, 4317]);
  });

  it("rejects a wrong count of waypoint (87) entries", () => {
    const res = fixture();
    const guide = route(res).guide;
    const i = guide.findIndex((g) => g.type === 87);
    guide[i + 1]!.duration += guide[i]!.duration;
    guide.splice(i, 1);
    const err = rejection(() => parseNaverOffsets(res, STOPS));
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/expected 1 waypoint \(87\) and 1 goal \(88\) guide entries, got 0 and 1/);
  });

  it("rejects stop times that miss the route total by more than 30 s", () => {
    const res = fixture();
    route(res).summary.duration += 31_000;
    expect(rejection(() => parseNaverOffsets(res, STOPS)).message).toMatch(/add up to 4316648 ms but the route total is 4347648 ms/);
    const close = fixture();
    route(close).summary.duration += 29_000;
    expect(parseNaverOffsets(close, STOPS)).toEqual([0, 4099, 4317]);
  });

  it("Drop-off snapped to an outside road: rejects a stop more than 150 m from where the route places it", () => {
    const moved = [...STOPS];
    moved[2] = { lat: 37.293999 + 0.00225, lng: 126.973183 }; // about 250 m north
    const err = rejection(() => parseNaverOffsets(fixture(), moved));
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/stop 2 is 2\d\d m from where the route places it/);
  });

  it("rejects offsets that go backwards", () => {
    const res = fixture();
    const guide = route(res).guide;
    const goal = guide.findIndex((g) => g.type === 88);
    guide[goal - 1]!.duration = -300_000;
    expect(rejection(() => parseNaverOffsets(res, STOPS)).message).toMatch(/stop 2 is reached before stop 1/);
  });

  it("reports a non-zero code as an API failure, not a route", () => {
    const err = rejection(() => parseNaverOffsets({ code: 1, message: "출발지와 도착지가 동일합니다." }, STOPS));
    expect(err.kind).toBe("api");
    expect(err.retryable).toBe(false);
  });
});

describe("fetchNaverOffsets", () => {
  const CREDS = { keyId: "key-id-123", key: "secret-456" };
  beforeEach(() => mockedGet.mockReset());

  const axiosError = (fields: { status?: number; code?: string }) => {
    const err = new axios.AxiosError("boom", fields.code);
    if (fields.status) (err as { response?: unknown }).response = { status: fields.status };
    return err;
  };

  it("sends start, waypoints and goal as lng,lat, with the keys in headers only", async () => {
    mockedGet.mockResolvedValue({ data: fixture() });
    await expect(fetchNaverOffsets(STOPS, CREDS)).resolves.toEqual([0, 4099, 4317]);
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
    mockedGet.mockRejectedValueOnce(axiosError(fields)).mockResolvedValueOnce({ data: fixture() });
    await expect(fetchNaverOffsets(STOPS, CREDS, { retryDelayMs: 0 })).resolves.toEqual([0, 4099, 4317]);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("Revoked key: no retry after an authentication error, and the keys never reach the message", async () => {
    mockedGet.mockRejectedValue(axiosError({ status: 401 }));
    const err = (await fetchNaverOffsets(STOPS, CREDS, { retryDelayMs: 0 }).catch((e: unknown) => e)) as DirectionsError;
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(DirectionsError);
    expect(err).toMatchObject({ provider: "naver", kind: "auth", status: 401 });
    expect(JSON.stringify(err) + err.message + err.stack).not.toMatch(/secret-456|key-id-123/);
  });

  it("gives up after the one retry", async () => {
    mockedGet.mockRejectedValue(axiosError({ status: 502 }));
    await expect(fetchNaverOffsets(STOPS, CREDS, { retryDelayMs: 0 })).rejects.toMatchObject({ kind: "http", status: 502 });
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("omits waypoints for a two-stop sequence", async () => {
    mockedGet.mockRejectedValue(axiosError({ status: 400 }));
    await expect(fetchNaverOffsets([STOPS[0]!, STOPS[1]!], CREDS)).rejects.toMatchObject({ kind: "http" });
    expect(mockedGet.mock.calls[0]![1].params).not.toHaveProperty("waypoints");
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
