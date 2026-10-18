/**
 * BusRoutePathClient over a mocked axios and the captured TOPIS busRouteInfo
 * answers of Jongno 07 (add-jongro-route-lines D3): the two URLs it sends (the
 * stored key as it is, never encoded twice), the line in `no` order as
 * [lng, lat] numbers and the stations with the turnaround flag; and every
 * failure rejecting with no key in it: a refused key (HTTP 401), a header
 * code other than "0" ("4" included), an answer with no rows, a malformed row.
 */
jest.mock("../../infra/config", () => ({ api: { seoulBusServiceKey: "k3y%2Bsecret%3D%3D" } }));
jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, get: jest.fn(), isAxiosError: actual.isAxiosError } };
});

import fs from "fs";
import path from "path";
import axios from "axios";
import { UpstreamError } from "../../infra/upstream.error";
import { BusRoutePathClient } from "./bus-route-path.client";

const mockedGet = axios.get as jest.Mock;
const KEY = "k3y%2Bsecret%3D%3D";
const FIXTURES = path.join(__dirname, "../../../__tests__/nest/bus/fixtures");
const fixture = (name: string): Record<string, unknown> & { msgBody: { itemList: Array<Record<string, unknown>> } } =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
const PATH_ANSWER = fixture("topis-route-path-jongro07.json");
const STATIONS_ANSWER = fixture("topis-route-stations-jongro07.json");

function answer(pathBody: unknown = PATH_ANSWER, stationsBody: unknown = STATIONS_ANSWER): void {
  mockedGet.mockImplementation(async (url: string) => ({ data: url.includes("/getRoutePath?") ? pathBody : stationsBody }));
}

async function failureOf(call: Promise<unknown>): Promise<Error> {
  const err = await call.catch((e: unknown) => e);
  if (!(err instanceof Error)) throw new Error("expected the call to reject");
  return err;
}

beforeEach(() => {
  mockedGet.mockReset();
});

describe("BusRoutePathClient.fetchRoutePath", () => {
  it("asks both operations for the route with the stored key as it is", async () => {
    // Arrange
    answer();

    // Act
    await new BusRoutePathClient().fetchRoutePath("100900004");

    // Assert
    const urls = mockedGet.mock.calls.map(([url]) => url).sort();
    expect(urls).toEqual([
      `http://ws.bus.go.kr/api/rest/busRouteInfo/getRoutePath?serviceKey=${KEY}&busRouteId=100900004&resultType=json`,
      `http://ws.bus.go.kr/api/rest/busRouteInfo/getStaionByRoute?serviceKey=${KEY}&busRouteId=100900004&resultType=json`,
    ]);
    expect(mockedGet.mock.calls[0]![1]).toEqual({ timeout: 10_000 });
  });

  it("returns the line in `no` order as [lng, lat] numbers, however TOPIS orders the rows", async () => {
    // Arrange
    const shuffled = structuredClone(PATH_ANSWER);
    shuffled.msgBody.itemList.reverse();
    answer(shuffled);

    // Act
    const fetched = await new BusRoutePathClient().fetchRoutePath("100900004");

    // Assert
    expect(fetched.path).toHaveLength(12);
    expect(fetched.path[0]).toEqual([126.9921543446, 37.5881571127]);
    expect(fetched.path[1]).toEqual([126.9921650734, 37.5881358585]);
  });

  it("returns the stations in `seq` order with the turnaround stop flagged", async () => {
    // Arrange
    answer();

    // Act
    const { stations } = await new BusRoutePathClient().fetchRoutePath("100900004");

    // Assert
    expect(stations.map((s) => [s.sequence, s.stationName, s.isTurnaround])).toEqual([
      [1, "성균관대운동장", false],
      [2, "학생회관", false],
      [13, "방송통신대앞", true],
      [22, "600주년기념관", false],
    ]);
    expect(stations[0]).toEqual({ topisId: "100900220", arsId: "01617", stationName: "성균관대운동장", sequence: 1, lng: 126.99237, lat: 37.587863, isTurnaround: false });
  });

  it("rejects a refused key (HTTP 401) without the key in the error", async () => {
    // Arrange
    const refusal = new axios.AxiosError("Request failed with status code 401", "ERR_BAD_REQUEST", { url: `http://ws.bus.go.kr/x?serviceKey=${KEY}` } as never);
    (refusal as { response?: unknown }).response = { status: 401, data: { error: "Unauthorized" } };
    mockedGet.mockRejectedValue(refusal);

    // Act
    const err = await failureOf(new BusRoutePathClient().fetchRoutePath("100900004"));

    // Assert
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toContain("401");
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain("k3y");
  });

  it.each(["4", "8"])('rejects header code "%s" with the code and message', async (headerCd) => {
    // Arrange
    answer({ ...PATH_ANSWER, msgHeader: { headerCd, headerMsg: "결과가 없습니다.", itemCount: 0 }, msgBody: { itemList: null } });

    // Act
    const err = await failureOf(new BusRoutePathClient().fetchRoutePath("100900004"));

    // Assert
    expect(err).toMatchObject({ upstream: "topis", headerCd, headerMsg: "결과가 없습니다." });
  });

  it("rejects an answer with no rows, or one that is not a list answer", async () => {
    // Arrange
    const noRows = { ...STATIONS_ANSWER, msgBody: { itemList: [] } };

    // Act
    answer(PATH_ANSWER, noRows);
    const empty = await failureOf(new BusRoutePathClient().fetchRoutePath("100900004"));
    answer({ error: "Unauthorized" });
    const foreign = await failureOf(new BusRoutePathClient().fetchRoutePath("100900004"));

    // Assert
    expect(empty.message).toBe("TOPIS answer has no rows (getStaionByRoute 100900004)");
    expect(foreign.message).toBe("TOPIS answer is not a route info list (getRoutePath 100900004)");
  });

  it("rejects a row whose coordinate is not a decimal", async () => {
    // Arrange
    const broken = structuredClone(PATH_ANSWER);
    broken.msgBody.itemList[3]!.gpsX = "";
    answer(broken);

    // Act
    const err = await failureOf(new BusRoutePathClient().fetchRoutePath("100900004"));

    // Assert
    expect(err.message).toBe("TOPIS row 3 is malformed (getRoutePath 100900004)");
  });
});
