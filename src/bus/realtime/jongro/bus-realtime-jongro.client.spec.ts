/**
 * BusRealtimeJongroClient over a mocked axios: TOPIS's arrival and position
 * envelopes translated to the cached shapes (an arrival row's two buses with
 * their numbers parsed, a row without them rejected), "0" and "4" accepted, any other
 * header code rejected with the code attached, "4" (no result, TOPIS's
 * overnight answer) read as an empty list, and any other answer without a
 * list rejected; a position row's vehicle, section, stop flag and KST
 * observation time kept, a row with one of them malformed rejected, and its
 * lastStTm kept as a number when it is one. Each URL is built from the route's
 * TOPIS id and SEOUL_BUS_SERVICE_KEY at the call, so importing the route config
 * needs no key, and a role that does not poll refuses to build one (ADR 0012, D4).
 */
jest.mock("axios", () => ({ get: jest.fn() }));

import arrivalsFixture from "../../../../__tests__/nest/bus/fixtures/topis-jongro-arrivals.json";
import positionsFixture from "../../../../__tests__/nest/bus/fixtures/topis-jongro-positions.json";
import { JONGRO_ROUTES } from "../../bus.constants";
import { toJongroRoute } from "../../bus.mapper";
import { BusRealtimeJongroClient } from "./bus-realtime-jongro.client";

const jongroRoutes = JONGRO_ROUTES.map(toJongroRoute);

const axios = require("axios") as { get: jest.Mock };
const route07 = jongroRoutes.find((r) => r.code === "07")!;
const KEY = process.env.SEOUL_BUS_SERVICE_KEY;
const respond = (data: unknown) => axios.get.mockResolvedValue({ data });
// What TOPIS sends in a row's bus fields when it names no bus (topis-jongro-arrivals.json, the second bus of jongro07Waiting ord 2).
const NO_BUS_FIELDS = Object.fromEntries(
  ["1", "2"].flatMap((slot) => [
    [`vehId${slot}`, "0"],
    [`plainNo${slot}`, " "],
    [`sectOrd${slot}`, "0"],
    [`traTime${slot}`, "0"],
    [`isLast${slot}`, "0"],
    [`rerdie_Div${slot}`, "0"],
    [`reride_Num${slot}`, "0"],
    [`arrmsg${slot}`, "출발대기"],
  ]),
);

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
            ...NO_BUS_FIELDS,
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
    expect(axios.get).toHaveBeenCalledWith(
      `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${KEY}&busRouteId=100900004&resultType=json`,
      { timeout: 10000 },
    );
  });

  it("extracts last 4 chars of plainNo1 as carNumber", async () => {
    // Arrange
    respond({
      msgHeader: { headerCd: "0" },
      msgBody: {
        itemList: [
          { ...NO_BUS_FIELDS, stId: "100900204", staOrd: "1", stNm: "성균관대학교", plainNo1: "서울74사1234", mkTm: "", arsId: "01881", arrmsg1: "곧 도착" },
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

  it("reads no result (4) as an empty list, so the tick still writes", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." }, msgBody: { itemList: null } });

    // Act & Assert
    expect(await new BusRealtimeJongroClient().fetchArrivals(route07)).toEqual([]);
  });

  it("rejects a body with no envelope, naming the list", async () => {
    // Arrange
    respond(null);

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchArrivals(route07)).rejects.toMatchObject({
      name: "UpstreamError",
      upstream: "topis",
      message: "TOPIS response has no itemList (jongro 07 list)",
    });
  });

  it("rejects a 0 answer whose itemList is null", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: null } });

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchArrivals(route07)).rejects.toMatchObject({
      name: "UpstreamError",
      headerCd: "0",
    });
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

// WHY: the realtime route derives each station's arrivals from the two buses a row names, so the client keeps
// both as TOPIS sent them, numbers parsed, next to the fields installed apps already read.
describe("BusRealtimeJongroClient.fetchArrivals buses", () => {
  const stationAt = async (response: unknown, staOrd: string) => {
    respond(response);
    const arrivals = await new BusRealtimeJongroClient().fetchArrivals(route07);
    return arrivals.find((arrival) => arrival.sequence === staOrd)!;
  };

  it("keeps the first and the second bus of a captured row", async () => {
    // Act
    const station = await stationAt(arrivalsFixture.jongro07Running, "16");

    // Assert
    expect(station.buses).toEqual([
      {
        traTime: 128,
        sectOrd: 15,
        staOrd: 16,
        arrmsg: "2분8초후[1번째 전]",
        isLast: false,
        plainNo: "서울70사5537",
        vehId: "100000103",
        rerideDiv: 2,
        rerideNum: 0,
      },
      {
        traTime: 761,
        sectOrd: 3,
        staOrd: 16,
        arrmsg: "12분41초후[13번째 전]",
        isLast: false,
        plainNo: "서울70사5538",
        vehId: "100000114",
        rerideDiv: 2,
        rerideNum: 7,
      },
    ]);
  });

  it("keeps a second bus with no vehicle as TOPIS sent it", async () => {
    // Act
    const station = await stationAt(arrivalsFixture.jongro07Waiting, "2");

    // Assert
    expect(station.buses[1]).toEqual({
      traTime: 0,
      sectOrd: 0,
      staOrd: 2,
      arrmsg: "출발대기",
      isLast: false,
      plainNo: " ",
      vehId: "0",
      rerideDiv: 0,
      rerideNum: 0,
    });
  });

  it("keeps eta as the first bus's text and every field installed apps read", async () => {
    // Act
    const station = await stationAt(arrivalsFixture.jongro07Waiting, "2");

    // Assert
    expect(station).toMatchObject({
      stationId: "100900221",
      sequence: "2",
      stationName: "학생회관",
      carNumber: "5536",
      eventDate: "2026-10-17 19:16:06.0",
      stationNumber: "01618",
      eta: "출발대기",
    });
  });

  it("reads the last-bus flag 1 as true", async () => {
    // Arrange
    const [row] = arrivalsFixture.jongro07Running.msgBody.itemList;
    const lastBus = { ...arrivalsFixture.jongro07Running, msgBody: { itemList: [{ ...row, isLast1: "1" }] } };

    // Act
    const station = await stationAt(lastBus, row!.staOrd);

    // Assert
    expect(station.buses.map((bus) => bus.isLast)).toEqual([true, false]);
  });

  it("reads a passenger count or congestion type that is not a number as null", async () => {
    // Arrange
    const [row] = arrivalsFixture.jongro07Running.msgBody.itemList;
    const blank = { ...arrivalsFixture.jongro07Running, msgBody: { itemList: [{ ...row, rerdie_Div1: "", reride_Num1: "" }] } };

    // Act
    const station = await stationAt(blank, row!.staOrd);

    // Assert
    expect(station.buses[0]).toMatchObject({ rerideDiv: null, rerideNum: null });
  });

  it("rejects a row whose travel time is not a number, naming the field", async () => {
    // Arrange
    const [row] = arrivalsFixture.jongro07Running.msgBody.itemList;
    respond({ ...arrivalsFixture.jongro07Running, msgBody: { itemList: [{ ...row, traTime2: null }] } });

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchArrivals(route07)).rejects.toMatchObject({
      name: "UpstreamError",
      upstream: "topis",
      message: "TOPIS row has a non-numeric traTime2 (jongro 07 list)",
    });
  });
});

describe("BusRealtimeJongroClient.fetchSightings", () => {
  it("maps location data", async () => {
    // Arrange
    respond({
      msgHeader: { headerCd: "0" },
      msgBody: {
        itemList: [
          {
            lastStnId: "100900197",
            gpsX: "126.998",
            gpsY: "37.587",
            plainNo: "서울74사5537",
            trnstnid: "100900028",
            vehId: "100000103",
            sectOrd: "6",
            sectDist: "0.1",
            fullSectDist: "0.3",
            stopFlag: "0",
            dataTm: "20261020100000",
          },
        ],
      },
    });

    // Act
    const result = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    // WHY: the row carries the vehicle fields as TOPIS does, plainNo the full plate as TOPIS sent it (ADR 0019, D6).
    expect(result).toEqual([
      {
        stationId: "100900197",
        latitude: "37.587",
        longitude: "126.998",
        carNumber: "5537",
        plainNo: "서울74사5537",
        turnaroundStationId: "100900028",
        vehicleId: "100000103",
        sectOrd: 6,
        sectDist: 0.1,
        fullSectDist: 0.3,
        isAtStop: false,
        observedAt: "2026-10-20T10:00:00+09:00",
      },
    ]);
    expect(axios.get).toHaveBeenCalledWith(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${KEY}&busRouteId=100900004&resultType=json`,
      { timeout: 10000 },
    );
  });

  it("reads no result (4), TOPIS's overnight answer, as no bus", async () => {
    // Arrange
    respond({ msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." }, msgBody: { itemList: null } });

    // Act & Assert
    expect(await new BusRealtimeJongroClient().fetchSightings(route07)).toEqual([]);
  });

  it("rejects a body with no envelope, naming the location list", async () => {
    // Arrange
    respond("<OpenAPI_ServiceResponse></OpenAPI_ServiceResponse>");

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchSightings(route07)).rejects.toMatchObject({
      name: "UpstreamError",
      message: "TOPIS response has no itemList (jongro 07 location)",
    });
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

// WHY: the registry sync follows the turnaround stop TOPIS names on every position row (ADR 0014, D4).
describe("BusRealtimeJongroClient.fetchSightings turnaround stop", () => {
  it("keeps each row's turnaround stop id (trnstnid)", async () => {
    // Arrange
    respond(positionsFixture.jongro07);

    // Act
    const sightings = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    expect(sightings.map((s) => [s.stationId, s.turnaroundStationId])).toEqual([
      ["100900221", "100900028"],
      ["100900043", "100900028"],
    ]);
  });
});

// WHY: getBusPosByRtid is the position endpoint that names the turnaround stop; it puts the coordinates in gpsY/gpsX
// and leaves tmX/tmY null (the 2026-10-17 capture), so a row without a stop or a coordinate is not its shape.
describe("BusRealtimeJongroClient.fetchSightings over getBusPosByRtid", () => {
  it("reads the coordinates from gpsY and gpsX, as strings", async () => {
    // Arrange
    respond(positionsFixture.jongro07);

    // Act
    const sightings = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    // WHY: each sighting also carries its vehicle fields, pinned below.
    expect(sightings.map(({ stationId, latitude, longitude, carNumber, turnaroundStationId }) => ({ stationId, latitude, longitude, carNumber, turnaroundStationId }))).toEqual([
      { stationId: "100900221", latitude: "37.586893", longitude: "126.994075", carNumber: "5538", turnaroundStationId: "100900028" },
      { stationId: "100900043", latitude: "37.576948", longitude: "127.002008", carNumber: "5537", turnaroundStationId: "100900028" },
    ]);
  });

  it("reads a row without trnstnid as naming no turnaround stop", async () => {
    // Arrange
    const [row] = positionsFixture.jongro07.msgBody.itemList;
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [{ ...row, trnstnid: undefined }] } });

    // Act
    const [sighting] = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    expect(sighting).toHaveProperty("turnaroundStationId", undefined);
    expect(sighting!.stationId).toBe("100900221");
  });

  it.each(["lastStnId", "gpsX", "gpsY"])("rejects a row without %s, naming the field", async (field) => {
    // Arrange
    const [row] = positionsFixture.jongro07.msgBody.itemList;
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [{ ...row, [field]: null }] } });

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchSightings(route07)).rejects.toMatchObject({
      name: "UpstreamError",
      upstream: "topis",
      message: `TOPIS row has no ${field} (jongro 07 location)`,
    });
  });
});

// WHY: the vehicle, its place in the section, the stop flag and TOPIS's observation time are what the realtime
// response tracks a bus by; none was malformed in the 1,117 captured rows.
describe("BusRealtimeJongroClient.fetchSightings vehicle fields", () => {
  it("keeps each captured row's vehicle, section, stop flag and observation time", async () => {
    // Arrange
    respond(positionsFixture.jongro07);

    // Act
    const sightings = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    expect(sightings.map(({ vehicleId, sectOrd, sectDist, fullSectDist, isAtStop, observedAt }) => ({ vehicleId, sectOrd, sectDist, fullSectDist, isAtStop, observedAt }))).toEqual([
      { vehicleId: "100000114", sectOrd: 2, sectDist: 0.06, fullSectDist: 0.289, isAtStop: false, observedAt: "2026-10-17T19:11:45+09:00" },
      { vehicleId: "100000103", sectOrd: 14, sectDist: 0, fullSectDist: 0.295, isAtStop: true, observedAt: "2026-10-17T19:11:44+09:00" },
    ]);
  });

  it.each([
    ["vehId", "", "vehId"],
    ["vehId", null, "vehId"],
    ["sectOrd", "x", "sectOrd"],
    ["sectDist", null, "sectDist"],
    ["fullSectDist", "", "fullSectDist"],
    ["dataTm", "2026-10-17 19:11:45", "dataTm"],
  ])("rejects a row whose %s is %j, naming the field", async (field, value, named) => {
    // Arrange
    const [row] = positionsFixture.jongro07.msgBody.itemList;
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [{ ...row, [field]: value }] } });

    // Act & Assert
    await expect(new BusRealtimeJongroClient().fetchSightings(route07)).rejects.toMatchObject({
      name: "UpstreamError",
      upstream: "topis",
      message: `TOPIS row has a malformed ${named} (jongro 07 location)`,
    });
  });

  it.each([
    ["1", true],
    ["0", false],
    [null, false],
  ])("reads stopFlag %j as at a stop: %s", async (stopFlag, expected) => {
    // Arrange
    const [row] = positionsFixture.jongro07.msgBody.itemList;
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [{ ...row, stopFlag }] } });

    // Act
    const [sighting] = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    expect(sighting!.isAtStop).toBe(expected);
  });
});

// WHY: lastStTm, the seconds to the terminal, is 0 only at the origin, which tells an idling bus there
// apart from one creeping out; every one of the 1,117 captured rows carried it.
describe("BusRealtimeJongroClient.fetchSightings seconds to the terminal", () => {
  it("keeps each captured row's lastStTm as a number", async () => {
    // Arrange
    respond(positionsFixture.jongro07);

    // Act
    const sightings = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    expect(sightings.map((sighting) => sighting.lastStTm)).toEqual([1387, 711]);
  });

  it("reads lastStTm \"0\" as 0", async () => {
    // Arrange
    const [row] = positionsFixture.jongro07.msgBody.itemList;
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [{ ...row, lastStTm: "0" }] } });

    // Act
    const [sighting] = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    expect(sighting!.lastStTm).toBe(0);
  });

  it.each([null, "", "x"])("reads lastStTm %j as unknown", async (lastStTm) => {
    // Arrange
    const [row] = positionsFixture.jongro07.msgBody.itemList;
    respond({ msgHeader: { headerCd: "0" }, msgBody: { itemList: [{ ...row, lastStTm }] } });

    // Act
    const [sighting] = await new BusRealtimeJongroClient().fetchSightings(route07);

    // Assert
    expect(sighting!.lastStTm).toBeUndefined();
  });
});

describe("BusRealtimeJongroClient outside a polling role", () => {
  it("refuses to build a TOPIS URL under ROLE=api, naming the key, and sends nothing", async () => {
    // Arrange
    const previous = process.env.ROLE;
    process.env.ROLE = "api";
    axios.get.mockClear();

    try {
      // Act & Assert
      await expect(new BusRealtimeJongroClient().fetchArrivals(route07)).rejects.toThrow(/SEOUL_BUS_SERVICE_KEY/);
      await expect(new BusRealtimeJongroClient().fetchSightings(route07)).rejects.toThrow(/SEOUL_BUS_SERVICE_KEY/);
      expect(axios.get).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.ROLE;
      else process.env.ROLE = previous;
    }
  });
});
