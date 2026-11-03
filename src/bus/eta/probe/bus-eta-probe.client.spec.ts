/**
 * BusEtaProbeClient over a mocked axios and the captured TOPIS answer: the URL
 * it sends (the stored key as it is, never encoded twice), the buses it
 * returns (empty on "no result", one from a lone object, a bad one left out
 * and logged), its one retry, its daily cap, and no key in any failure. A
 * failure rejects as an UpstreamError with what failed, as the other TOPIS
 * clients do, from what TOPIS answered on 2026-11-03: the gateway's 401 as a
 * refused key and Apache's 503 page as an outage.
 */
jest.mock("../../../infra/config", () => ({ api: { seoulBusServiceKey: "k3y%2Bsecret%3D%3D" }, shuttleEta: { topisDailyCap: 2 } }));
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  return { ...actual, __esModule: true, default: { ...actual.default, get: jest.fn() }, isAxiosError: actual.isAxiosError };
});

import fs from "fs";
import path from "path";
import axios from "axios";
import gateway from "../../../../__tests__/nest/bus/fixtures/topis-gateway-answers.json";
import { UpstreamError } from "../../../infra/upstream.error";
import { DailyCapError } from "../../../shared/daily-cap.error";
import { BusEtaProbeClient } from "./bus-eta-probe.client";

const logger = require("../../../infra/logger");
const mockedGet = axios.get as jest.Mock;

const KEY = "k3y%2Bsecret%3D%3D";
const NOW = new Date("2026-10-17T03:24:00.000Z");
const CAPTURED: { msgBody: { itemList: Array<Record<string, unknown>> } } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../../__tests__/nest/bus/fixtures/topis-buspos-rtid-5005.json"), "utf8"),
);
const captured = () => JSON.parse(JSON.stringify(CAPTURED));

const axiosError = (fields: { status?: number; body?: unknown; code?: string }) => {
  const err = new axios.AxiosError("boom", fields.code, { url: `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${KEY}` } as never);
  if (fields.status) (err as { response?: unknown }).response = { status: fields.status, data: fields.body };
  return err;
};

async function failureOf(call: Promise<unknown>): Promise<Error> {
  const err = await call.catch((e: unknown) => e);
  if (!(err instanceof Error)) throw new Error("expected the call to reject");
  return err;
}

beforeEach(() => {
  mockedGet.mockReset();
  jest.clearAllMocks();
});

describe("BusEtaProbeClient.fetchPositions", () => {
  it("sends the stored key as it is, URL-encoded once, with the route and JSON asked for", async () => {
    // Arrange
    mockedGet.mockResolvedValue({ data: captured() });

    // Act
    await new BusEtaProbeClient().fetchPositions("228000175", NOW);

    // Assert
    const [url, opts] = mockedGet.mock.calls[0]!;
    expect(url).toBe(`http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${KEY}&busRouteId=228000175&resultType=json`);
    expect(url).not.toContain("%25");
    expect(opts).not.toHaveProperty("params");
    expect(opts.timeout).toBe(5_000);
  });

  it("returns each bus with its position, section and GPS time", async () => {
    // Arrange
    mockedGet.mockResolvedValue({ data: captured() });

    // Act
    const positions = await new BusEtaProbeClient().fetchPositions("228000175", NOW);

    // Assert
    expect(positions).toEqual([
      { vehId: "228000155", lat: 37.228304, lng: 127.215442, sectOrd: 6, dataTm: new Date("2026-10-17T03:23:11.000Z") },
      { vehId: "228000128", lat: 37.339173, lng: 127.103543, sectOrd: 33, dataTm: new Date("2026-10-17T03:22:13.000Z") },
      { vehId: "228000166", lat: 37.290379, lng: 127.103493, sectOrd: 75, dataTm: new Date("2026-10-17T03:21:32.000Z") },
    ]);
  });

  it('returns no bus on "4", no result, whose itemList is null', async () => {
    // Arrange
    mockedGet.mockResolvedValue({ data: { msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." }, msgBody: { itemList: null } } });

    // Act & Assert
    await expect(new BusEtaProbeClient().fetchPositions("228000175", NOW)).resolves.toEqual([]);
  });

  it("reads one bus sent as an object instead of a list", async () => {
    // Arrange
    const body = captured();
    body.msgBody.itemList = body.msgBody.itemList[1];
    mockedGet.mockResolvedValue({ data: body });

    // Act
    const positions = await new BusEtaProbeClient().fetchPositions("228000175", NOW);

    // Assert
    expect(positions.map((p) => p.vehId)).toEqual(["228000128"]);
  });

  it("leaves out a bus that does not parse, keeps the others, and logs it", async () => {
    // Arrange
    const body = captured();
    body.msgBody.itemList[0].gpsX = null;
    mockedGet.mockResolvedValue({ data: body });

    // Act
    const positions = await new BusEtaProbeClient().fetchPositions("228000175", NOW);

    // Assert
    expect(positions.map((p) => p.vehId)).toEqual(["228000128", "228000166"]);
    expect(logger.warn).toHaveBeenCalledWith(
      { event: "bus.lane.positions_dropped", routeId: "228000175", invalid: ["228000155: gpsX"] },
      expect.any(String),
    );
  });

  it.each([
    ["a header code other than data or no result", { msgHeader: { headerCd: "7", headerMsg: "인증 실패" } }, { headerCd: "7", headerMsg: "인증 실패" }],
    ["a body that is not a TOPIS answer", "<html>maintenance</html>", { failure: { kind: "shape", detail: "not a bus position answer" } }],
  ])("rejects %s as an UpstreamError, without retrying", async (_case, data, fields) => {
    // Arrange
    mockedGet.mockResolvedValue({ data });

    // Act
    const err = await failureOf(new BusEtaProbeClient().fetchPositions("228000175", NOW, { retryDelayMs: 0 }));

    // Assert
    expect(err).toMatchObject({ name: "UpstreamError", upstream: "topis", ...fields });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a timeout", { code: "ECONNABORTED" }],
    ["a reset", { code: "ECONNRESET" }],
    ["a 5xx", { status: 503 }],
  ])("retries once after %s", async (_case, fields) => {
    // Arrange
    mockedGet.mockRejectedValueOnce(axiosError(fields)).mockResolvedValueOnce({ data: captured() });

    // Act
    const positions = await new BusEtaProbeClient().fetchPositions("228000175", NOW, { retryDelayMs: 0 });

    // Assert
    expect(positions).toHaveLength(3);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx, and gives up after the one retry", async () => {
    // Arrange
    mockedGet.mockRejectedValueOnce(axiosError({ status: 404 }));
    const client = new BusEtaProbeClient();

    // Act
    const refused = await failureOf(client.fetchPositions("228000175", NOW, { retryDelayMs: 0 }));
    mockedGet.mockRejectedValue(axiosError({ status: 502 }));
    const failed = await failureOf(client.fetchPositions("228000175", NOW, { retryDelayMs: 0 }));

    // Assert
    expect(refused).toMatchObject({ name: "UpstreamError", upstream: "topis", failure: { kind: "outage", status: 404 } });
    expect(failed).toMatchObject({ name: "UpstreamError", upstream: "topis", failure: { kind: "outage", status: 502 } });
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["the gateway's 401 for an unregistered key as a refused key, without retrying", gateway.wrongKey, { kind: "auth", status: 401, message: "유효하지 않은 서비스키입니다: 등록되지 않은 서비스키" }, 1],
    ["a 429 as a spent quota, without retrying", { status: 429, body: "" }, { kind: "quota", message: "Too Many Requests" }, 1],
    ["Apache's 503 page as an outage, after its one retry", gateway.outage, { kind: "outage", status: 503 }, 2],
  ])("rejects %s", async (_case, answer, failure, callCount) => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError(answer));

    // Act
    const err = await failureOf(new BusEtaProbeClient().fetchPositions("228000175", NOW, { retryDelayMs: 0 }));

    // Assert
    expect(err).toMatchObject({ name: "UpstreamError", upstream: "topis", failure });
    expect(mockedGet).toHaveBeenCalledTimes(callCount);
  });

  it("never carries the key in a failure: the axios error holding the URL stays inside", async () => {
    // Arrange
    mockedGet.mockRejectedValue(axiosError({ status: 500 }));

    // Act
    const err = await failureOf(new BusEtaProbeClient().fetchPositions("228000175", NOW, { retryDelayMs: 0 }));

    // Assert
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).not.toHaveProperty("cause");
    expect(JSON.stringify(err) + err.message + String(err.stack)).not.toMatch(/k3y|secret|serviceKey/);
  });

  it("takes each request from the daily cap, and refuses the one past it without a call", async () => {
    // Arrange
    mockedGet.mockResolvedValue({ data: captured() });
    const client = new BusEtaProbeClient();
    await client.fetchPositions("228000175", NOW);
    await client.fetchPositions("228000174", NOW);

    // Act
    const err = await failureOf(client.fetchPositions("200000205", NOW));

    // Assert
    expect(err).toBeInstanceOf(DailyCapError);
    expect(err).toMatchObject({ provider: "topis", cap: 2 });
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});
