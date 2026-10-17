/**
 * SubwaySeoulApiClient against the Seoul real-time subway API as it answered
 * on 2026-10-09 and 2026-10-16 (captured fixtures in
 * __tests__/nest/subway/fixtures/, see each file's `_about`).
 * What it guards: one request per line or station, with the key and the
 * URL-encoded name in the path and a 5 s timeout; the rows handed back as
 * captured, duplicates included; `INFO-200` read as no rows; and every
 * failure (an HTTP status, a timeout, a refused key, a body of another shape)
 * rejecting with a SubwaySeoulApiError that names the source, status and code
 * and carries neither the URL nor the key.
 */
import fs from "fs";
import path from "path";
import axios from "axios";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, get: jest.fn() }, isAxiosError: actual.isAxiosError };
});
const mockedGet = axios.get as jest.Mock;

import config from "../../infra/config";
import { SubwaySeoulApiError } from "./subway-seoul-api.error";
import { SubwaySeoulApiClient } from "./subway-seoul-api.client";

type Payload = Record<string, unknown>;

const API_ROOT = `http://swopenapi.seoul.go.kr/api/subway/${config.subway.seoulApiKey}/json`;
const fixture = (name: string): Payload =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/subway/fixtures", name), "utf8"));
const POSITIONS_LINE_1 = fixture("realtime-position-line1.json");
const ARRIVALS_HYEHWA = fixture("realtime-arrival-hyehwa.json");
const NO_DATA = fixture("realtime-arrival-no-data.json");
const INVALID_KEY = fixture("realtime-error-invalid-key.json");

const client = new SubwaySeoulApiClient();
const respond = (data: unknown) => mockedGet.mockResolvedValue({ status: 200, data });

/** An axios error as axios builds one: its config and request hold the URL, and with it the key. */
function axiosError(fields: { status?: number; code?: string }): Error {
  const url = `${API_ROOT}/realtimePosition/0/400/${encodeURIComponent("1호선")}`;
  const requestConfig = { url, timeout: 5000 };
  const request = { path: url, _header: `GET ${url} HTTP/1.1` };
  const response = fields.status === undefined ? undefined : { status: fields.status, data: "<html>error</html>", config: requestConfig, headers: {}, statusText: "" };
  return new axios.AxiosError("boom", fields.code, requestConfig as never, request, response as never);
}

async function failureOf(call: Promise<unknown>): Promise<SubwaySeoulApiError> {
  return (await call.catch((err: unknown) => err)) as SubwaySeoulApiError;
}

function leaksNothing(err: Error): void {
  const serialized = JSON.stringify(err) + err.message + String(err.stack);
  expect(serialized).not.toContain(config.subway.seoulApiKey);
  expect(serialized).not.toContain("swopenapi");
}

function withFirstPosition(edit: Payload): Payload {
  const copy = JSON.parse(JSON.stringify(POSITIONS_LINE_1)) as { realtimePositionList: Payload[] };
  copy.realtimePositionList[0] = { ...copy.realtimePositionList[0], ...edit };
  return copy as unknown as Payload;
}

beforeEach(() => {
  mockedGet.mockReset();
});

describe("SubwaySeoulApiClient.fetchPositions", () => {
  it("asks realtimePosition for every train of one line, the key and the encoded line name in the path", async () => {
    // Arrange
    respond(POSITIONS_LINE_1);

    // Act
    await client.fetchPositions("1호선");

    // Assert
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(`${API_ROOT}/realtimePosition/0/400/1%ED%98%B8%EC%84%A0`, { timeout: 5000 });
  });

  it("hands back all 74 rows of the 22:27 capture, the duplicate rows of train 0509 included", async () => {
    // Arrange
    respond(POSITIONS_LINE_1);

    // Act
    const rows = await client.fetchPositions("1호선");

    // Assert
    expect(rows).toHaveLength(74);
    expect(rows[0]).toEqual({ trainNo: "0509", statnNm: "시청", statnTnm: "서동탄", trainSttus: "1", recptnDt: "2026-10-16 22:26:51" });
    expect(rows.filter((row) => row.trainNo === "0509")).toHaveLength(2);
  });

  it("reads INFO-200, the answer for no data, as no rows", async () => {
    // Arrange
    respond(NO_DATA);

    // Act & Assert
    await expect(client.fetchPositions("1호선")).resolves.toEqual([]);
  });

  it("a row whose train number is not four digits rejects as an unexpected shape", async () => {
    // Arrange
    respond(withFirstPosition({ trainNo: "K509" }));

    // Act
    const err = await failureOf(client.fetchPositions("1호선"));

    // Assert
    expect(err).toBeInstanceOf(SubwaySeoulApiError);
    expect(err).toMatchObject({ source: "seoul-subway-api", status: 200, code: "unexpected_shape" });
  });

  it.each([
    ["an HTML body", "<html><body>점검 중</body></html>"],
    ["a success without rows", { errorMessage: { status: 200, code: "INFO-000", message: "정상 처리되었습니다." } }],
    ["a row with an unknown trainSttus", withFirstPosition({ trainSttus: "9" })],
    ["a row without recptnDt", withFirstPosition({ recptnDt: null })],
  ])("%s rejects as an unexpected shape", async (_label, data) => {
    // Arrange
    respond(data);

    // Act
    const err = await failureOf(client.fetchPositions("1호선"));

    // Assert
    expect(err).toBeInstanceOf(SubwaySeoulApiError);
    expect(err).toMatchObject({ status: 200, code: "unexpected_shape" });
  });
});

describe("SubwaySeoulApiClient.fetchArrivals", () => {
  it("asks realtimeStationArrival for one station, the key and the encoded name in the path", async () => {
    // Arrange
    respond(ARRIVALS_HYEHWA);

    // Act
    await client.fetchArrivals("혜화");

    // Assert
    expect(mockedGet).toHaveBeenCalledWith(`${API_ROOT}/realtimeStationArrival/0/50/%ED%98%9C%ED%99%94`, { timeout: 5000 });
  });

  it("hands back the four 혜화 rows of 2026-10-09 22:45, each with its countdown", async () => {
    // Arrange
    respond(ARRIVALS_HYEHWA);

    // Act
    const rows = await client.fetchArrivals("혜화");

    // Assert
    expect(rows).toEqual([
      { subwayId: "1004", btrainNo: "4674", statnNm: "혜화", barvlDt: "150", recptnDt: "2026-10-09 22:44:20" },
      { subwayId: "1004", btrainNo: "4174", statnNm: "혜화", barvlDt: "390", recptnDt: "2026-10-09 22:44:20" },
      { subwayId: "1004", btrainNo: "4331", statnNm: "혜화", barvlDt: "240", recptnDt: "2026-10-09 22:44:20" },
      { subwayId: "1004", btrainNo: "4173", statnNm: "혜화", barvlDt: "960", recptnDt: "2026-10-09 22:44:20" },
    ]);
  });

  it("reads INFO-200 as no rows, as a station answers at night", async () => {
    // Arrange
    respond(NO_DATA);

    // Act & Assert
    await expect(client.fetchArrivals("혜화")).resolves.toEqual([]);
  });
});

describe("SubwaySeoulApiClient on a failure", () => {
  it("Upstream error: a 500 names the source and status, and serializes without the URL or the key", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 500, code: "ERR_BAD_RESPONSE" }));

    // Act
    const err = await failureOf(client.fetchPositions("1호선"));

    // Assert
    expect(err).toBeInstanceOf(SubwaySeoulApiError);
    expect(err).toMatchObject({ source: "seoul-subway-api", status: 500, code: "ERR_BAD_RESPONSE" });
    expect(err.cause).toBeUndefined();
    leaksNothing(err);
  });

  it("a timeout carries its code and no status, and serializes without the URL or the key", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ code: "ECONNABORTED" }));

    // Act
    const err = await failureOf(client.fetchArrivals("혜화"));

    // Assert
    expect(err).toBeInstanceOf(SubwaySeoulApiError);
    expect(err).toMatchObject({ source: "seoul-subway-api", code: "ECONNABORTED" });
    expect(err.status).toBeUndefined();
    leaksNothing(err);
  });

  it("a refused key, answered with HTTP 200 and INFO-100, rejects with the body's status and code", async () => {
    // Arrange
    respond(INVALID_KEY);

    // Act
    const err = await failureOf(client.fetchPositions("1호선"));

    // Assert
    expect(err).toBeInstanceOf(SubwaySeoulApiError);
    expect(err).toMatchObject({ source: "seoul-subway-api", status: 500, code: "INFO-100" });
    leaksNothing(err);
  });

  it("a code other than INFO-000 under errorMessage rejects with that code", async () => {
    // Arrange
    respond({ errorMessage: { status: 500, code: "ERROR-500", message: "서버 오류입니다." }, realtimeArrivalList: [] });

    // Act
    const err = await failureOf(client.fetchArrivals("혜화"));

    // Assert
    expect(err).toMatchObject({ source: "seoul-subway-api", status: 500, code: "ERROR-500" });
  });
});
