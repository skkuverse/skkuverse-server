/**
 * The arrival URL every Jongro route polls: byte-identical to the URL
 * production has called since the registry was introduced, so a refactor of
 * the builder cannot change what TOPIS is asked. The position URL depends on
 * the stored stations, so it is the registry's (bus-registry.mapper.spec.ts).
 */
import { toJongroArrivalsUrl } from "./bus.mapper";

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
