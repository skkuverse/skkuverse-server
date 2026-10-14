/**
 * BusRealtimeJongroClient over a mocked axios: TOPIS's arrival and position
 * envelopes translated to the cached shapes, "0" and "4" accepted, any other
 * header code rejected with the code attached, and a missing list read as
 * nothing to store.
 */
jest.mock("axios", () => ({ get: jest.fn() }));

import { jongroRoutes } from "../../bus.config";
import { BusRealtimeJongroClient } from "./bus-realtime-jongro.client";

const axios = require("axios") as { get: jest.Mock };
const route07 = jongroRoutes.find((r) => r.code === "07")!;
const respond = (data: unknown) => axios.get.mockResolvedValue({ data });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BusRealtimeJongroClient.fetchArrivals", () => {
  it("maps bus list data correctly", async () => {
    // Arrange
    respond({
      msgHeader: { headerCd: "0" },
      msgBody: {
        itemList: [
          {
            stId: "100900197",
            staOrd: "1",
            stNm: "명륜새마을금고",
            plainNo1: "서울74사5537",
            mkTm: "2024-01-01 12:00:00",
            arsId: "01504",
            arrmsg1: "3분후[1번째 전]",
          },
        ],
      },
    });

    // Act
    const result = await new BusRealtimeJongroClient().fetchArrivals(route07);

    // Assert
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      stationId: "100900197",
      sequence: "1",
      stationName: "명륜새마을금고",
      carNumber: "5537",
      stationNumber: "01504",
      eta: "3분후[1번째 전]",
    });
    expect(axios.get).toHaveBeenCalledWith(route07.arrivalsUrl, { timeout: 10000 });
  });

  it("extracts last 4 chars of plainNo1 as carNumber", async () => {
    // Arrange
    respond({
      msgHeader: { headerCd: "0" },
      msgBody: {
        itemList: [
          { stId: "100900204", staOrd: "1", stNm: "성균관대학교", plainNo1: "서울74사1234", mkTm: "", arsId: "01881", arrmsg1: "곧 도착" },
        ],
      },
    });

    // Act
    const result = await new BusRealtimeJongroClient().fetchArrivals(route07);

    // Assert
    expect(result![0]!.carNumber).toBe("1234");
  });

  it("handles empty itemList → empty list array", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [] } });

    // Act & Assert
    expect(await new BusRealtimeJongroClient().fetchArrivals(route07)).toHaveLength(0);
  });

  it("reads no result (4) and a missing envelope as nothing to store", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." }, msgBody: { itemList: null } });

    // Act & Assert
    expect(await new BusRealtimeJongroClient().fetchArrivals(route07)).toBeNull();
    respond(null);
    expect(await new BusRealtimeJongroClient().fetchArrivals(route07)).toBeNull();
  });

  it("rejects on a TOPIS error code, carrying the code", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "7", headerMsg: "인증 실패" }, msgBody: { itemList: null } });

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchArrivals(route07)).rejects.toMatchObject({
      name: "UpstreamError",
      headerCd: "7",
      message: "TOPIS error code (jongro 07 list)",
    });
  });
});

describe("BusRealtimeJongroClient.fetchSightings", () => {
  it("maps location data", async () => {
    // Arrange
    respond({
      msgHeader: { headerCd: "0" },
      msgBody: { itemList: [{ lastStnId: "100900197", tmX: "126.998", tmY: "37.587", plainNo: "서울74사5537" }] },
    });

    // Act
    const result = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    expect(result).toEqual([{ stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537" }]);
    expect(axios.get).toHaveBeenCalledWith(route07.positionsUrl, { timeout: 10000 });
  });

  it("rejects each route's tick on an API error", async () => {
    // Arrange
    axios.get.mockRejectedValue(new Error("Network error"));

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchSightings(route07)).rejects.toThrow("Network error");
  });

  it("rejects on a TOPIS error code, naming the location list", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "8", headerMsg: "한도 초과" } });

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchSightings(route07)).rejects.toMatchObject({
      name: "UpstreamError",
      upstream: "topis",
      headerCd: "8",
      headerMsg: "한도 초과",
      message: "TOPIS error code (jongro 07 location)",
    });
  });
});
