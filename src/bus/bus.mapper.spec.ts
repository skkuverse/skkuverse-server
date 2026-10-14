/**
 * The two TOPIS URLs every Jongro route polls: byte-identical to the URLs
 * production has called since the registry was introduced, so a refactor of
 * the builders cannot change what TOPIS is asked.
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
