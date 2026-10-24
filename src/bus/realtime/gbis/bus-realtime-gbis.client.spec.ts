/**
 * BusRealtimeGbisClient over a mocked axios: GBIS getBusLocationListv2 for a regional route, asked by its GBIS route
 * id (TOPIS's busRouteId for 7800) with DATA_GO_KR_SERVICE_KEY raw in the query parameters, which axios encodes once.
 * The 2026-10-24 capture translates to each bus's vehId (the TOPIS id of the same bus) and seats left; a negative
 * remainSeatCnt is no information; resultCode 4 (no bus running) is an empty list; one bus answered as an object is
 * one bus; any other result code, an answer not in its shape, or a failed request rejects as an UpstreamError that
 * keeps the status or code and never the key; a data.go.kr gateway refusal other than the quota (its XML or JSON
 * envelope, in a 200 or an HTTP error) rejects naming its returnReasonCode and message. A data.go.kr refusal of the key's spent daily quota (code 22), in a
 * 200 or an HTTP error, rejects the same way and also logs `bus.gbis.quota_exceeded`, at most once a minute, which an
 * alert reads: only seats are lost until the quota resets.
 */
jest.mock("axios", () => ({ get: jest.fn(), isAxiosError: (err: unknown) => (err as { isAxiosError?: boolean }).isAxiosError === true }));
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import capture from "../../../../__tests__/nest/bus/fixtures/gbis-location-7800.json";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import { REGIONAL_ROUTES } from "../../bus.constants";
import { BusRealtimeGbisClient } from "./bus-realtime-gbis.client";

const axios = require("axios") as { get: jest.Mock };
const ROUTE_7800 = REGIONAL_ROUTES.find((route) => route.code === "7800")!;
const respond = (data: unknown) => axios.get.mockResolvedValue({ data });
const GATEWAY_REFUSAL =
  "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
const quotaLines = () => jest.mocked(logger.warn).mock.calls.filter(([fields]) => (fields as { event?: string }).event === "bus.gbis.quota_exceeded").map(([fields]) => fields);
const httpError = (status: number | undefined, data?: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, code: status === undefined ? "ECONNABORTED" : "ERR_BAD_RESPONSE", response: status === undefined ? undefined : { status, data }, config: { params: { serviceKey: config.gbis.serviceKey } } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusRealtimeGbisClient.fetchSeats", () => {
  it("asks getBusLocationListv2 for the route's GBIS id, the raw key in the query parameters, as JSON", async () => {
    // Arrange
    respond(capture);

    // Act
    await new BusRealtimeGbisClient().fetchSeats(ROUTE_7800);

    // Assert
    expect(axios.get).toHaveBeenCalledWith("https://apis.data.go.kr/6410000/buslocationservice/v2/getBusLocationListv2", {
      params: { serviceKey: config.gbis.serviceKey, routeId: "200000150", format: "json" },
      timeout: 10_000,
    });
  });

  it("translates the captured answer to each bus's vehId and seats left, in GBIS's order", async () => {
    // Arrange
    respond(capture);

    // Act
    const seats = await new BusRealtimeGbisClient().fetchSeats(ROUTE_7800);

    // Assert
    expect(seats).toHaveLength(14);
    expect(seats.slice(0, 3)).toEqual([
      { vehicleId: "200010839", seatsLeft: 41 },
      { vehicleId: "200011684", seatsLeft: 37 },
      { vehicleId: "233000065", seatsLeft: 35 },
    ]);
    expect(seats.map(({ seatsLeft }) => seatsLeft)).toEqual([41, 37, 35, 65, 35, 70, 39, 23, 31, 17, 60, 38, 70, 70]);
  });

  it("serves a negative remainSeatCnt as no information", async () => {
    // Arrange
    respond({ response: { msgHeader: { resultCode: 0 }, msgBody: { busLocationList: [{ vehId: 200010839, remainSeatCnt: -1 }] } } });

    // Act & Assert
    await expect(new BusRealtimeGbisClient().fetchSeats(ROUTE_7800)).resolves.toEqual([{ vehicleId: "200010839", seatsLeft: null }]);
  });

  it("reads resultCode 4, no bus running, as no buses", async () => {
    // Arrange
    respond({ response: { comMsgHeader: "", msgHeader: { queryTime: "2026-10-25 02:00:00.000", resultCode: 4, resultMessage: "결과가 존재하지 않습니다." } } });

    // Act & Assert
    await expect(new BusRealtimeGbisClient().fetchSeats(ROUTE_7800)).resolves.toEqual([]);
  });

  it("reads one bus answered as an object as one bus", async () => {
    // Arrange
    respond({ response: { msgHeader: { resultCode: 0 }, msgBody: { busLocationList: { vehId: 200011531, remainSeatCnt: 17 } } } });

    // Act & Assert
    await expect(new BusRealtimeGbisClient().fetchSeats(ROUTE_7800)).resolves.toEqual([{ vehicleId: "200011531", seatsLeft: 17 }]);
  });

  it.each([
    ["another result code", { response: { msgHeader: { resultCode: 1, resultMessage: "시스템 에러가 발생하였습니다." } } }, "1"],
    ["an answer not in its shape", { response: { msgHeader: { resultCode: 0 }, msgBody: { busLocationList: [{ vehId: "N" }] } } }, undefined],
    ["an HTML page", "<html>404</html>", undefined],
  ])("rejects %s as an UpstreamError", async (_label, body, headerCd) => {
    // Arrange
    respond(body);

    // Act & Assert
    await expect(new BusRealtimeGbisClient().fetchSeats(ROUTE_7800)).rejects.toMatchObject({ name: "UpstreamError", upstream: "gbis", headerCd });
    expect(quotaLines()).toEqual([]);
  });

  it.each([
    ["an HTTP error", httpError(500, "<html>error</html>"), /HTTP 500/],
    ["a request that never got an answer", httpError(undefined), /ECONNABORTED/],
  ])("rejects %s with its status or code, never the key", async (_label, err, message) => {
    // Arrange
    axios.get.mockRejectedValue(err);

    // Act
    const rejection = (await new BusRealtimeGbisClient().fetchSeats(ROUTE_7800).catch((caught: unknown) => caught)) as Error;

    // Assert
    expect(rejection).toMatchObject({ name: "UpstreamError", upstream: "gbis" });
    expect(rejection.message).toMatch(message);
    expect(JSON.stringify({ ...rejection, message: rejection.message })).not.toContain(config.gbis.serviceKey);
  });
});

describe("BusRealtimeGbisClient over a gateway refusal other than the quota", () => {
  const xmlRefusal = (code: string, authMsg: string) =>
    `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>${authMsg}</returnAuthMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

  it.each([
    ["the per-second limit in XML, code 23", xmlRefusal("23", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR"), "23", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR"],
    ["an unregistered key in XML, code 30", xmlRefusal("30", "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"), "30", "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"],
    ["a missing key in JSON, code 20", { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NULL", returnAuthMsg: "SERVICE_KEY_IS_NULL", returnReasonCode: "20" } } }, "20", "SERVICE_KEY_IS_NULL"],
    ["an expired key in JSON with errMsg only, code 31", { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "DEADLINE_HAS_EXPIRED_ERROR", returnReasonCode: "31" } } }, "31", "DEADLINE_HAS_EXPIRED_ERROR"],
  ])("rejects %s in a 200 naming its code, and logs no quota line", async (_label, body, code, message) => {
    // Arrange
    respond(body);

    // Act
    const rejection = (await new BusRealtimeGbisClient().fetchSeats(ROUTE_7800).catch((caught: unknown) => caught)) as Error;

    // Assert
    expect(rejection).toMatchObject({ name: "UpstreamError", upstream: "gbis", headerCd: code, headerMsg: message });
    expect(rejection.message).toContain(`(${code})`);
    expect(rejection.message).not.toContain(config.gbis.serviceKey);
    expect(quotaLines()).toEqual([]);
  });

  it("rejects the per-second limit sent as an HTTP error naming its code", async () => {
    // Arrange
    axios.get.mockRejectedValue(httpError(429, xmlRefusal("23", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR")));

    // Act & Assert
    await expect(new BusRealtimeGbisClient().fetchSeats(ROUTE_7800)).rejects.toMatchObject({ name: "UpstreamError", upstream: "gbis", headerCd: "23" });
    expect(quotaLines()).toEqual([]);
  });
});

describe("BusRealtimeGbisClient over a spent daily quota", () => {
  it("Gateway answers its refusal in a 200: rejects with code 22 and logs the operation", async () => {
    // Arrange
    respond(GATEWAY_REFUSAL);

    // Act & Assert
    await expect(new BusRealtimeGbisClient().fetchSeats(ROUTE_7800)).rejects.toMatchObject({ name: "UpstreamError", upstream: "gbis", headerCd: "22" });
    expect(quotaLines()).toEqual([{ event: "bus.gbis.quota_exceeded", operation: "getBusLocationListv2", code: "7800", suppressed: 0 }]);
  });

  it("Gateway refuses with an HTTP error: rejects with code 22, not the raw error, and logs the operation", async () => {
    // Arrange
    axios.get.mockRejectedValue(httpError(429, GATEWAY_REFUSAL));

    // Act & Assert
    await expect(new BusRealtimeGbisClient().fetchSeats(ROUTE_7800)).rejects.toMatchObject({ name: "UpstreamError", upstream: "gbis", headerCd: "22" });
    expect(quotaLines()).toEqual([{ event: "bus.gbis.quota_exceeded", operation: "getBusLocationListv2", code: "7800", suppressed: 0 }]);
  });

  it("logs a spent quota once a minute, counting the lines it left out", async () => {
    // Arrange
    jest.useFakeTimers({ now: new Date("2026-10-24T14:00:00Z") });
    const client = new BusRealtimeGbisClient();
    respond(GATEWAY_REFUSAL);

    // Act
    try {
      for (let i = 0; i < 3; i++) await client.fetchSeats(ROUTE_7800).catch(() => undefined);
      jest.setSystemTime(new Date("2026-10-24T14:01:00Z"));
      await client.fetchSeats(ROUTE_7800).catch(() => undefined);
    } finally {
      jest.useRealTimers();
    }

    // Assert
    expect(quotaLines()).toEqual([
      { event: "bus.gbis.quota_exceeded", operation: "getBusLocationListv2", code: "7800", suppressed: 0 },
      { event: "bus.gbis.quota_exceeded", operation: "getBusLocationListv2", code: "7800", suppressed: 2 },
    ]);
  });
});
