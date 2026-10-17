/**
 * The two TOPIS URLs every Jongro route polls: byte-identical to the URLs
 * production has called since the registry was introduced, so a refactor of
 * the builders cannot change what TOPIS is asked.
 */
import { toJongroArrivalsUrl, toJongroPositionsUrl, toJongroRoute } from "./bus.mapper";

const FIXED_KEY =
  "FAKEseoulBusServiceKeyForTestsOnlyNotARealKey0000%2BFAKE%2Fseoul%2Bbus%2Ftest0key%3D%3D";

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
  it("builds the 종로02 loc URL identically (endOrd=26)", () => {
    // Act & Assert
    expect(toJongroPositionsUrl("100900008", 26, FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRouteSt?serviceKey=${FIXED_KEY}&busRouteId=100900008&startOrd=1&endOrd=26&resultType=json`,
    );
  });

  it("builds the 종로07 loc URL identically (endOrd=22)", () => {
    // Act & Assert
    expect(toJongroPositionsUrl("100900004", 22, FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRouteSt?serviceKey=${FIXED_KEY}&busRouteId=100900004&startOrd=1&endOrd=22&resultType=json`,
    );
  });
});

describe("toJongroRoute", () => {
  const station = (topisId: string, ends: { isFirstStation?: boolean; isLastStation?: boolean } = {}) => ({
    stationName: `stop ${topisId}`,
    arsId: "01000",
    topisId,
    isFirstStation: false,
    isLastStation: false,
    isRotationStation: false,
    transferLines: [],
    ...ends,
  });
  const entry = (topisIds: string[]) => ({
    id: "jongro07",
    busRouteId: "100900004",
    themeColor: "4CAF50",
    iconType: "village",
    refreshInterval: 30,
    seatCount: 18,
    stations: topisIds.map((id, index) => station(id, { isFirstStation: index === 0, isLastStation: index === topisIds.length - 1 })),
  });

  it("maps no TOPIS id the registry does not list, Object.prototype names included", () => {
    // Act
    const { mapping } = toJongroRoute(entry(["100900204", "100900197"]), FIXED_KEY);

    // Assert
    expect(mapping["constructor"]).toBeUndefined();
    expect(mapping["toString"]).toBeUndefined();
    expect(mapping["100900197"]).toEqual({ sequence: 2, stationName: "stop 100900197" });
  });

  it("maps a listed TOPIS id that names an Object.prototype member", () => {
    // Act
    const { mapping } = toJongroRoute(entry(["100900204", "constructor"]), FIXED_KEY);

    // Assert
    expect(mapping["constructor"]).toEqual({ sequence: 2, stationName: "stop constructor" });
  });
});
