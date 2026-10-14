/**
 * The Jongro registry loaded from jongro-routes.json: the routes it derives
 * (stations in TOPIS order, the TOPIS stop mapping, the polled URLs), frozen
 * so a mutation downstream throws, and the boot-time refusals of a malformed
 * file. The registry is TOPIS's stop list verbatim: stations[i] is TOPIS ord
 * i + 1.
 */
import { jongroRoutes, loadJongroRoutes } from "./bus.config";

function issuesOf(raw: unknown): string[] {
  try {
    loadJongroRoutes(raw, "test-seoul-bus-key");
    return [];
  } catch (err) {
    return (err as Error).message.split("; ");
  }
}

describe("jongroRoutes derived from jongro-routes.json", () => {
  it("loads 02, 07 and 08 in order", () => {
    // Act & Assert
    expect(jongroRoutes).toHaveLength(3);
    expect(jongroRoutes[0]!.id).toBe("jongro02");
    expect(jongroRoutes[0]!.code).toBe("02");
    expect(jongroRoutes[1]!.id).toBe("jongro07");
    expect(jongroRoutes[1]!.code).toBe("07");
    expect(jongroRoutes[2]!.id).toBe("jongro08");
    expect(jongroRoutes[2]!.code).toBe("08");
  });

  it("builds 종로08 from TOPIS route 100900005: 31 stops, 회차 at 재향군인회관", () => {
    // Arrange
    const r08 = jongroRoutes.find((r) => r.id === "jongro08")!;

    // Assert
    expect(r08.busRouteId).toBe("100900005");
    expect(r08.stations).toHaveLength(31);
    expect(r08.positionsUrl).toContain("&endOrd=31&");
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
    // Arrange
    const r02 = jongroRoutes.find((r) => r.id === "jongro02")!;
    const r07 = jongroRoutes.find((r) => r.code === "07")!;

    // Assert
    expect(r02.stations).toHaveLength(27);
    expect(r07.stations).toHaveLength(22);

    // 02 closes its loop: TOPIS lists its campus stop at ord 1 and again at ord 27.
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
    // Arrange
    const r02 = jongroRoutes.find((r) => r.code === "02")!;

    // Assert
    expect(r02.stations[0]!.sequence).toBe("1");
    expect(r02.stations[0]!.stationNumber).toBe("01881");
    expect(r02.stations[26]!.sequence).toBe("27");
    expect(r02.stations[26]!.stationNumber).toBe("01881");
  });

  it("derives the topisId→{sequence,stationName} mapping correctly", () => {
    // Arrange
    const r02 = jongroRoutes.find((r) => r.id === "jongro02")!;
    const r07 = jongroRoutes.find((r) => r.id === "jongro07")!;

    // Assert
    expect(r02.mapping["100900086"]).toEqual({ sequence: 10, stationName: "헌법재판소.안국역" });
    expect(r02.mapping["100900204"]).toEqual({ sequence: 1, stationName: "성균관대학교" });
    expect(r07.mapping["100900197"]).toEqual({ sequence: 6, stationName: "명륜새마을금고" });
    expect(r07.mapping["100900028"]).toEqual({ sequence: 13, stationName: "방송통신대앞" });
  });

  // A bus whose last passed stop is the terminal has just left it, so the
  // loop-closing repeat must not steal the mapping from ord 1.
  it("maps a loop-closing repeat to its first ord, and lists every ord in topisIds", () => {
    // Arrange
    const r02 = jongroRoutes.find((r) => r.id === "jongro02")!;

    // Assert
    expect(r02.mapping["100900204"]).toEqual({ sequence: 1, stationName: "성균관대학교" });
    expect(r02.topisIds).toHaveLength(27);
    expect(r02.topisIds[0]).toBe("100900204");
    expect(r02.topisIds[26]).toBe("100900204");
  });

  // A stop added to 07 in both directions (2026-09): the two share a name, so only
  // their TOPIS IDs tell them apart.
  it("maps both 종로07 비천당 stops to their own campus leg", () => {
    // Arrange
    const r07 = jongroRoutes.find((r) => r.id === "jongro07")!;

    // Assert
    expect(r07.mapping["100000423"]).toEqual({ sequence: 21, stationName: "비천당" });
    expect(r07.mapping["100000424"]).toEqual({ sequence: 3, stationName: "비천당" });
    expect(r07.stations[19]!.stationName).toBe("성균관대정문");
    expect(r07.stations[21]!.stationName).toBe("600주년기념관");
    expect(r07.stations[1]!.stationName).toBe("학생회관");
    expect(r07.stations[3]!.stationName).toBe("성균관대정문");
  });

  it("builds the 종로07 loc URL over every TOPIS ord", () => {
    // Act & Assert
    expect(jongroRoutes.find((r) => r.code === "07")!.positionsUrl).toContain("&endOrd=22&");
    expect(jongroRoutes.find((r) => r.code === "02")!.positionsUrl).toContain("&endOrd=27&");
  });

  // A stop served by several routes (07/08 share ten) or listed twice (02's
  // loop close) is one physical stop, so it must show the same subway badges
  // everywhere; a badge edited on one route only would drift silently.
  it("gives every occurrence of a stop the same transferLines", () => {
    // Arrange
    const byStop = new Map<string, string>();
    const mismatches: string[] = [];
    const raw = require("./jongro-routes.json") as Array<{
      id: string;
      stations: Array<{ topisId: string; stationName: string; transferLines: unknown[] }>;
    }>;
    for (const route of raw) {
      for (const s of route.stations) {
        const lines = JSON.stringify(s.transferLines);
        const seen = byStop.get(s.topisId);
        if (seen === undefined) byStop.set(s.topisId, lines);
        else if (seen !== lines) mismatches.push(`${route.id} ${s.stationName} (${s.topisId})`);
      }
    }

    // Assert
    expect(mismatches).toEqual([]);
  });

  it("uses one color per subway line across every route", () => {
    // Arrange
    const colorByLine = new Map<string, Set<string>>();
    for (const route of jongroRoutes) {
      for (const s of route.stations) {
        for (const t of s.transferLines) {
          if (!colorByLine.has(t.line)) colorByLine.set(t.line, new Set());
          colorByLine.get(t.line)!.add(t.color);
        }
      }
    }
    const conflicting = [...colorByLine].filter(([, colors]) => colors.size > 1);

    // Assert
    expect(conflicting).toEqual([]);
  });

  it("carries the transfer badges added from the 2026-09 review", () => {
    // Arrange
    const lines = (code: string, name: string, nth = 0) => {
      const matches = jongroRoutes.find((r) => r.code === code)!.stations.filter((s) => s.stationName === name);
      return matches[nth]!.transferLines.map((t) => t.line);
    };

    // Assert
    expect(lines("08", "서울특별시재향군인회관")).toEqual(["1"]);
    expect(lines("08", "효제초교.연동교회.김마리아활동터")).toEqual(["1"]);
    expect(lines("08", "방송통신대앞")).toEqual(["4"]);
    expect(lines("07", "성대입구")).toEqual(["4"]);
    expect(lines("07", "방송통신대앞")).toEqual(["4"]);
    expect(lines("02", "종로2가.탑골공원")).toEqual(["1", "3", "5"]);
    expect(lines("02", "조계사")).toEqual(["1"]);
    expect(lines("02", "재동초등학교")).toEqual(["3"]);
    expect(lines("02", "아름다운가게.정독도서관")).toEqual(["3"]);
    expect(lines("02", "가회동주민센터", 0)).toEqual(["3"]);
    expect(lines("02", "가회동주민센터", 1)).toEqual(["3"]);
  });

  it("preserves transferLines on metro-connected stops", () => {
    // Arrange
    const r02 = jongroRoutes.find((r) => r.code === "02")!;

    // Assert
    expect(r02.stations[11]!.transferLines).toEqual([
      { line: "1", color: "0052A4" },
      { line: "3", color: "EF7C1C" },
      { line: "5", color: "996CAC" },
    ]);
  });
});

describe("jongroRoutes deep freeze (mutations fail at runtime)", () => {
  it("freezes route-level fields", () => {
    // Arrange
    const r = jongroRoutes.find((route) => route.code === "02")!;

    // Assert
    expect(Object.isFrozen(r)).toBe(true);
    expect(() => {
      (r as { id: string }).id = "X";
    }).toThrow();
  });

  it("freezes nested stations (array + each element)", () => {
    // Arrange
    const r = jongroRoutes.find((route) => route.code === "02")!;

    // Assert
    expect(Object.isFrozen(r.stations)).toBe(true);
    expect(Object.isFrozen(r.stations[0])).toBe(true);
    expect(() => {
      (r.stations as unknown[]).push({} as never);
    }).toThrow();
  });

  it("freezes mapping records (no key add or value mutation)", () => {
    // Arrange
    const r = jongroRoutes.find((route) => route.code === "02")!;

    // Assert
    expect(Object.isFrozen(r.mapping)).toBe(true);
    expect(() => {
      (r.mapping as Record<string, unknown>).fake = "X";
    }).toThrow();
  });
});

describe("loadJongroRoutes validation (fail-loud surfaces)", () => {
  it("accepts the real shipped data with zero errors", () => {
    // Arrange
    const raw = require("./jongro-routes.json");

    // Assert
    expect(issuesOf(raw)).toEqual([]);
  });

  it("rejects non-array top-level", () => {
    // Arrange
    const errors = issuesOf({ id: "jongro02" });

    // Assert
    expect(errors[0]).toMatch(/must be a JSON array/);
  });

  it("rejects route with bad id pattern", () => {
    // Arrange
    const errors = issuesOf([
      { id: "jongroX", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, stations: [
        { stationName: "a", arsId: "1", topisId: "t1", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
        { stationName: "b", arsId: "2", topisId: "t2", isFirstStation: false, isLastStation: true, isRotationStation: false, transferLines: [] },
      ] },
    ]);

    // Assert
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
    // Arrange
    const errors = issuesOf(routeOf(stn("DUP", true), stn("DUP"), stn("t3", false, true)));

    // Assert
    expect(errors.some((e) => e.includes('duplicate "DUP"'))).toBe(true);
  });

  it("accepts the last stop repeating the first (TOPIS loop close)", () => {
    // Act & Assert
    expect(issuesOf(routeOf(stn("A", true), stn("B"), stn("A", false, true)))).toEqual([]);
  });

  it("rejects the last stop repeating a middle stop", () => {
    // Arrange
    const errors = issuesOf(routeOf(stn("A", true), stn("B"), stn("B", false, true)));

    // Assert
    expect(errors.some((e) => e.includes('duplicate "B"'))).toBe(true);
  });
});
