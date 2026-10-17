/**
 * The two TOPIS URLs every Jongro route polls: the arrival URL byte-identical
 * to the one production has called since the registry was introduced, and the
 * position URL of getBusPosByRtid, which answers the whole route (no ord
 * range) and names its turnaround stop.
 */
import { toJongroArrivalsUrl, toJongroPositionsUrl } from "./bus.mapper";

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
  it("asks getBusPosByRtid for the whole 종로07 route", () => {
    // Act & Assert
    expect(toJongroPositionsUrl("100900004", FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${FIXED_KEY}&busRouteId=100900004&resultType=json`,
    );
  });
});
