/**
 * The Jongro mapper: a sighting placed on a registry stop becomes the cached
 * bus position the realtime route reads, at its section ord with its vehicle
 * fields, and since when it has stood at its stop, and its bus type when
 * TOPIS named one (left out otherwise, as a poller older than the field wrote it).
 * The two TOPIS URLs every Jongro route polls: the arrival URL byte-identical
 * to the one production has called since the registry was introduced, and the
 * position URL of getBusPosByRtid, which answers the whole route (no ord
 * range) and names its turnaround stop. An arrival text is cut to 64
 * characters, so the per-request arrival patterns read bounded text.
 */
import { jongroSighting } from "../../../../__tests__/helpers/bus/jongro-sighting";
import { toArrmsg, toJongroArrivalsUrl, toJongroBusPosition, toJongroPositionsUrl } from "./bus-realtime-jongro.mapper";

describe("toJongroBusPosition", () => {
  it.each([
    ["lowFloor", { busType: "lowFloor" }],
    ["general", { busType: "general" }],
  ] as const)("keeps the sighting's bus type %s", (busType, expected) => {
    // Arrange
    const sighting = jongroSighting({ busType });

    // Act
    const position = toJongroBusPosition(sighting, { sequence: 6, stationName: "명륜새마을금고" }, { firstSeenAt: "2026-10-20T01:00:00.000Z", dwellSeconds: 0, isStationary: false });

    // Assert
    expect(position).toMatchObject(expected);
  });

  it("leaves the bus type out when the sighting has none", () => {
    // Act
    const position = toJongroBusPosition(jongroSighting(), { sequence: 6, stationName: "명륜새마을금고" }, { firstSeenAt: "2026-10-20T01:00:00.000Z", dwellSeconds: 0, isStationary: false });

    // Assert
    expect(position).not.toHaveProperty("busType");
  });

  it("places the sighting on its stop with its dwell", () => {
    // Arrange
    const sighting = jongroSighting({ stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537", sectOrd: 6 });

    // Act
    const position = toJongroBusPosition(sighting, { sequence: 6, stationName: "명륜새마을금고" }, {
      firstSeenAt: "2026-10-20T01:00:00.000Z",
      dwellSeconds: 40,
      isStationary: false,
    });

    // Assert
    // WHY: the position carries the vehicle fields beside its other fields, plainNo the full plate (ADR 0019, D6).
    expect(position).toEqual({
      sequence: "6",
      stationName: "명륜새마을금고",
      carNumber: "5537",
      plainNo: "서울74사5537",
      eventDate: "2026-10-20T01:00:00.000Z",
      estimatedTime: 40,
      stationId: "100900197",
      latitude: "37.587",
      longitude: "126.998",
      recordTime: "2026-10-20T01:00:00.000Z",
      vehicleId: "100000103",
      sectDist: 0.15,
      fullSectDist: 0.3,
      isAtStop: false,
      observedAt: "2026-10-20T10:00:00+09:00",
      isStationary: false,
    });
  });

  it("takes the sequence from the section ord, so a loop end keeps its own ord", () => {
    // Act
    const position = toJongroBusPosition(jongroSighting({ stationId: "100900204", sectOrd: 27 }), { sequence: 1, stationName: "성균관대학교" }, {
      firstSeenAt: "2026-10-20T01:00:00.000Z",
      dwellSeconds: 0,
      isStationary: true,
    });

    // Assert
    expect(position).toMatchObject({ sequence: "27", stationName: "성균관대학교", isStationary: true });
  });

  it("keeps since when the bus has stood at its stop, and leaves it out for a moving bus", () => {
    // Arrange
    const timing = { firstSeenAt: "2026-10-18T09:08:59.000Z", dwellSeconds: 21, isStationary: false };
    const stop = { sequence: 20, stationName: "성균관대학교" };

    // Act
    const atStop = toJongroBusPosition(jongroSighting({ sectOrd: 20, isAtStop: true }), stop, { ...timing, atStopSince: "2026-10-18T18:08:59+09:00" });
    const moving = toJongroBusPosition(jongroSighting({ sectOrd: 20 }), stop, timing);

    // Assert
    expect(atStop).toMatchObject({ isAtStop: true, atStopSince: "2026-10-18T18:08:59+09:00" });
    expect(moving).not.toHaveProperty("atStopSince");
  });
});

const FIXED_KEY =
  "FAKEseoulBusServiceKeyForTestsOnlyNotARealKey0000%2BFAKE%2Fseoul%2Bbus%2Ftest0key%3D%3D";

describe("toArrmsg", () => {
  it.each([
    ["가".repeat(63), "가".repeat(63)],
    ["가".repeat(64), "가".repeat(64)],
    ["가".repeat(65), "가".repeat(64)],
    ["2분8초후[1번째 전]", "2분8초후[1번째 전]"],
    ["", ""],
  ])("%j → %j", (text, expected) => {
    // Act & Assert
    expect(toArrmsg(text)).toBe(expected);
  });
});

describe("toJongroArrivalsUrl", () => {
  it("builds the 종로02 list URL identically (busRouteId=100900008)", () => {
    // Act & Assert
    expect(toJongroArrivalsUrl("100900008", FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${FIXED_KEY}&busRouteId=100900008&resultType=json`,
    );
  });

  it("builds the 종로07 list URL identically (busRouteId=100900004)", () => {
    // Act & Assert
    expect(toJongroArrivalsUrl("100900004", FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${FIXED_KEY}&busRouteId=100900004&resultType=json`,
    );
  });
});

describe("toJongroPositionsUrl", () => {
  it("asks getBusPosByRtid for the whole 종로07 route", () => {
    // Act & Assert
    expect(toJongroPositionsUrl("100900004", FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${FIXED_KEY}&busRouteId=100900004&resultType=json`,
    );
  });
});
