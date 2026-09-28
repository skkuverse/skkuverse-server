/**
 * Nest port of jongro-registry.test.ts — exercised through the src re-export
 * (src/bus/registry/jongro-registry.ts re-exports features/bus/jongro.registry
 * verbatim) so the derived registry / URL builders / freeze semantics are
 * proven byte-identical via the path the BusModule actually imports.
 *
 * Plus the jongroRoutesProvider useFactory: it must surface the registry at
 * bootstrap (fail-loud) and reject an empty/invalid array with NO silent ?? [].
 */

import {
  buildJongroListUrl,
  buildJongroLocUrl,
  jongroRoutes,
  validateRoutes,
  validateServiceKey,
  getJongroRouteByCode,
  getJongroRouteById,
} from "../../../src/bus/registry/jongro-registry";
import { jongroRoutesProvider } from "../../../src/bus/registry/jongro-registry.provider";

const FIXED_KEY =
  "FAKEseoulBusServiceKeyForTestsOnlyNotARealKey0000%2BFAKE%2Fseoul%2Bbus%2Ftest0key%3D%3D";

describe("jongro.registry — URL builders match the legacy prod URLs", () => {
  it("builds the 종로02 list URL identically (busRouteId=100900008)", () => {
    expect(buildJongroListUrl("100900008", FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${FIXED_KEY}&busRouteId=100900008&resultType=json`,
    );
  });

  it("builds the 종로02 loc URL identically (endOrd=26)", () => {
    expect(buildJongroLocUrl("100900008", 26, FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRouteSt?serviceKey=${FIXED_KEY}&busRouteId=100900008&startOrd=1&endOrd=26&resultType=json`,
    );
  });

  it("builds the 종로07 list URL identically (busRouteId=100900004)", () => {
    expect(buildJongroListUrl("100900004", FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${FIXED_KEY}&busRouteId=100900004&resultType=json`,
    );
  });

  it("builds the 종로07 loc URL identically (endOrd=22)", () => {
    expect(buildJongroLocUrl("100900004", 22, FIXED_KEY)).toBe(
      `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRouteSt?serviceKey=${FIXED_KEY}&busRouteId=100900004&startOrd=1&endOrd=22&resultType=json`,
    );
  });
});

describe("jongro.registry — derived routes from jongro-routes.json", () => {
  it("loads 02, 07 and 08 in order", () => {
    expect(jongroRoutes).toHaveLength(3);
    expect(jongroRoutes[0]!.id).toBe("jongro02");
    expect(jongroRoutes[0]!.code).toBe("02");
    expect(jongroRoutes[1]!.id).toBe("jongro07");
    expect(jongroRoutes[1]!.code).toBe("07");
    expect(jongroRoutes[2]!.id).toBe("jongro08");
    expect(jongroRoutes[2]!.code).toBe("08");
  });

  it("builds 종로08 from TOPIS route 100900005: 31 stops, 회차 at 재향군인회관", () => {
    const r08 = getJongroRouteById("jongro08")!;
    expect(r08.busRouteId).toBe("100900005");
    expect(r08.stations).toHaveLength(31);
    expect(r08.locUrl).toContain("&endOrd=31&");
    expect(r08.stations[0]!.isFirstStation).toBe(true);
    expect(r08.stations[0]!.stationName).toBe("명륜3가종점");
    expect(r08.stations[30]!.isLastStation).toBe(true);
    expect(r08.stations[30]!.stationName).toBe("샘미용실.종로구청소년상담복지센터");
    expect(r08.stations.filter((s) => s.isRotationStation).map((s) => s.stationName)).toEqual([
      "서울특별시재향군인회관",
    ]);
    expect(r08.stations[15]!.isRotationStation).toBe(true);
    expect(r08.stations[16]!.stationName).toBe("종로5가역.광장시장");
    expect(r08.stations[16]!.transferLines).toEqual([{ line: "1", color: "0052A4" }]);
    expect(r08.stations[9]!.transferLines).toEqual([{ line: "4", color: "00A5DE" }]);
  });

  // The registry is TOPIS's stop list verbatim: stations[i] is TOPIS ord i+1.
  it("preserves station counts (02=27, 07=22) and first/last flags in TOPIS order", () => {
    const r02 = getJongroRouteById("jongro02")!;
    const r07 = getJongroRouteByCode("07")!;
    expect(r02.stations).toHaveLength(27);
    expect(r07.stations).toHaveLength(22);

    // 02 closes its loop: TOPIS lists 성균관대학교 at ord 1 and again at ord 27.
    expect(r02.stations[0]!.isFirstStation).toBe(true);
    expect(r02.stations[0]!.stationName).toBe("성균관대학교");
    expect(r02.stations[25]!.stationName).toBe("성대후문.와룡공원");
    expect(r02.stations[26]!.isLastStation).toBe(true);
    expect(r02.stations[26]!.stationName).toBe("성균관대학교");

    expect(r07.stations[0]!.isFirstStation).toBe(true);
    expect(r07.stations[0]!.stationName).toBe("성균관대운동장");
    expect(r07.stations[21]!.isLastStation).toBe(true);
    expect(r07.stations[21]!.stationName).toBe("600주년기념관");

    expect(r02.stations[12]!.isRotationStation).toBe(true);
    expect(r07.stations[12]!.isRotationStation).toBe(true);
    expect(r07.stations[12]!.stationName).toBe("방송통신대앞");
  });

  it("derives sequence (1-based string) and stationNumber from arsId", () => {
    const r02 = getJongroRouteByCode("02")!;
    expect(r02.stations[0]!.sequence).toBe("1");
    expect(r02.stations[0]!.stationNumber).toBe("01881");
    expect(r02.stations[26]!.sequence).toBe("27");
    expect(r02.stations[26]!.stationNumber).toBe("01881");
  });

  it("derives the topisId→{sequence,stationName} mapping correctly", () => {
    const r02 = getJongroRouteById("jongro02")!;
    const r07 = getJongroRouteById("jongro07")!;

    expect(r02.mapping["100900086"]).toEqual({ sequence: 10, stationName: "헌법재판소.안국역" });
    expect(r02.mapping["100900204"]).toEqual({ sequence: 1, stationName: "성균관대학교" });
    expect(r07.mapping["100900197"]).toEqual({ sequence: 6, stationName: "명륜새마을금고" });
    expect(r07.mapping["100900028"]).toEqual({ sequence: 13, stationName: "방송통신대앞" });
  });

  // A bus whose last passed stop is the terminal has just left it, so the
  // loop-closing repeat must not steal the mapping from ord 1.
  it("maps a loop-closing repeat to its first ord, and lists every ord in topisIds", () => {
    const r02 = getJongroRouteById("jongro02")!;
    expect(r02.mapping["100900204"]).toEqual({ sequence: 1, stationName: "성균관대학교" });
    expect(r02.topisIds).toHaveLength(27);
    expect(r02.topisIds[0]).toBe("100900204");
    expect(r02.topisIds[26]).toBe("100900204");
  });

  // 비천당 was added to 종로07 in both directions (2026-09). The two stops share
  // a name, so only their TOPIS IDs tell them apart.
  it("maps both 종로07 비천당 stops to their own campus leg", () => {
    const r07 = getJongroRouteById("jongro07")!;
    expect(r07.mapping["100000423"]).toEqual({ sequence: 21, stationName: "비천당" });
    expect(r07.mapping["100000424"]).toEqual({ sequence: 3, stationName: "비천당" });
    expect(r07.stations[19]!.stationName).toBe("성균관대정문");
    expect(r07.stations[21]!.stationName).toBe("600주년기념관");
    expect(r07.stations[1]!.stationName).toBe("학생회관");
    expect(r07.stations[3]!.stationName).toBe("성균관대정문");
  });

  it("builds the 종로07 loc URL over every TOPIS ord", () => {
    expect(getJongroRouteByCode("07")!.locUrl).toContain("&endOrd=22&");
    expect(getJongroRouteByCode("02")!.locUrl).toContain("&endOrd=27&");
  });

  it("preserves transferLines on metro-connected stops", () => {
    const r02 = getJongroRouteByCode("02")!;
    expect(r02.stations[11]!.transferLines).toEqual([
      { line: "1", color: "0052A4" },
      { line: "3", color: "EF7C1C" },
      { line: "5", color: "996CAC" },
    ]);
  });
});

describe("jongro.registry — validateServiceKey (URL-encoded form)", () => {
  it("rejects missing / empty key with 'is required'", () => {
    expect(validateServiceKey(undefined).some((e) => e.includes("is required"))).toBe(true);
    expect(validateServiceKey("").some((e) => e.includes("is required"))).toBe(true);
  });

  it("rejects raw special chars that indicate non-URL-encoded form", () => {
    expect(validateServiceKey("ABC+DEF=").some((e) => e.includes("URL-encoded"))).toBe(true);
    expect(validateServiceKey("ABC&DEF").some((e) => e.includes("URL-encoded"))).toBe(true);
    expect(validateServiceKey("ABC DEF").some((e) => e.includes("URL-encoded"))).toBe(true);
  });

  it("accepts a properly URL-encoded prod-shaped key", () => {
    expect(validateServiceKey(FIXED_KEY)).toEqual([]);
    expect(validateServiceKey("test-seoul-bus-key")).toEqual([]);
  });
});

describe("jongro.registry — deep freeze (mutations fail at runtime)", () => {
  it("freezes route-level fields", () => {
    const r = getJongroRouteByCode("02")!;
    expect(Object.isFrozen(r)).toBe(true);
    expect(() => {
      (r as { id: string }).id = "X";
    }).toThrow();
  });

  it("freezes nested stations (array + each element)", () => {
    const r = getJongroRouteByCode("02")!;
    expect(Object.isFrozen(r.stations)).toBe(true);
    expect(Object.isFrozen(r.stations[0])).toBe(true);
    expect(() => {
      (r.stations as unknown[]).push({} as never);
    }).toThrow();
  });

  it("freezes mapping records (no key add or value mutation)", () => {
    const r = getJongroRouteByCode("02")!;
    expect(Object.isFrozen(r.mapping)).toBe(true);
    expect(() => {
      (r.mapping as Record<string, unknown>).fake = "X";
    }).toThrow();
  });
});

describe("jongro.registry — validation (fail-loud surfaces)", () => {
  it("accepts the real shipped data with zero errors", () => {
    const raw = require("../../../src/bus/registry/jongro-routes.json");
    expect(validateRoutes(raw).errors).toEqual([]);
  });

  it("rejects non-array top-level", () => {
    const { errors } = validateRoutes({ id: "jongro02" });
    expect(errors[0]).toMatch(/must be a JSON array/);
  });

  it("rejects route with bad id pattern", () => {
    const { errors } = validateRoutes([
      { id: "jongroX", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: false, isLastStation: true, isRotationStation: false, transferLines: [] },
      ] },
    ]);
    expect(errors.some((e) => e.includes("id: must match"))).toBe(true);
  });

  const stn = (topisId: string, first = false, last = false) => ({
    stationName: topisId, arsId: topisId, topisId,
    isFirstStation: first, isLastStation: last, isRotationStation: false, transferLines: [],
  });
  const routeOf = (...stations: unknown[]) => [
    { id: "jongro99", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations },
  ];

  it("rejects duplicate topisId within a route", () => {
    const { errors } = validateRoutes(routeOf(stn("DUP", true), stn("DUP"), stn("t3", false, true)));
    expect(errors.some((e) => e.includes('duplicate "DUP"'))).toBe(true);
  });

  it("accepts the last stop repeating the first (TOPIS loop close)", () => {
    expect(validateRoutes(routeOf(stn("A", true), stn("B"), stn("A", false, true))).errors).toEqual([]);
  });

  it("rejects the last stop repeating a middle stop", () => {
    const { errors } = validateRoutes(routeOf(stn("A", true), stn("B"), stn("B", false, true)));
    expect(errors.some((e) => e.includes('duplicate "B"'))).toBe(true);
  });
});

describe("jongroRoutesProvider — fail-loud factory (NO silent ?? [])", () => {
  it("returns the validated registry (non-empty, frozen)", () => {
    const factory = (jongroRoutesProvider as { useFactory: () => ReadonlyArray<unknown> })
      .useFactory;
    const routes = factory();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBe(3);
    // Same object as the re-exported registry.
    expect(routes).toBe(jongroRoutes);
  });
});
