/**
 * The committed Jongro route config loaded from jongro-routes.json: each
 * route's identity, seat count, arrival URL and transfer lines by ARS number,
 * frozen so a mutation downstream throws, and the boot-time refusals of a
 * malformed file. The stations are not here: they live in the registry
 * (src/bus/registry/, improve-jongro-realtime D6).
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

const routeOf = (overrides: Record<string, unknown> = {}) => [
  { id: "jongro99", busRouteId: "1", themeColor: "4CAF50", iconType: "village", refreshInterval: 40, seatCount: 18, transferLinesByArsId: {}, ...overrides },
];

describe("jongroRoutes derived from jongro-routes.json", () => {
  it("loads 02, 07 and 08 in order", () => {
    // Act & Assert
    expect(jongroRoutes.map((r) => [r.id, r.code, r.busRouteId])).toEqual([
      ["jongro02", "02", "100900008"],
      ["jongro07", "07", "100900004"],
      ["jongro08", "08", "100900005"],
    ]);
  });

  it("reads a seat count of 18 for every route", () => {
    // Act & Assert
    expect(jongroRoutes.map((r) => [r.id, r.seatCount])).toEqual([
      ["jongro02", 18],
      ["jongro07", 18],
      ["jongro08", 18],
    ]);
  });

  it("builds each route's arrival URL from its TOPIS route id", () => {
    // Act & Assert
    expect(jongroRoutes[1]!.arrivalsUrl).toContain("/arrive/getArrInfoByRouteAll?serviceKey=");
    expect(jongroRoutes[1]!.arrivalsUrl).toContain("&busRouteId=100900004&resultType=json");
  });

  it("builds each route's position URL over the whole route, whatever its stations", () => {
    // Act & Assert
    expect(jongroRoutes.map((r) => r.positionsUrl.replace(/serviceKey=[^&]*/, "serviceKey=K"))).toEqual(
      ["100900008", "100900004", "100900005"].map((id) => `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=K&busRouteId=${id}&resultType=json`),
    );
  });

  it("keys the transfer badges of the 2026-09 review by ARS number", () => {
    // Arrange
    const linesOf = (code: string, arsId: string) => jongroRoutes.find((r) => r.code === code)!.transferLinesByArsId[arsId]?.map((t) => t.line);

    // Assert
    expect(linesOf("02", "01589")).toEqual(["1", "3", "5"]);
    expect(linesOf("08", "01249")).toEqual(["1"]);
    expect(linesOf("08", "01877")).toEqual(["4"]);
    expect(linesOf("07", "01877")).toEqual(["4"]);
    expect(linesOf("02", "01881")).toBeUndefined();
  });

  // A stop served by several routes (07/08 share ten) is one physical stop, so it must
  // show the same subway badges everywhere; a badge edited on one route only would drift silently.
  it("gives an ARS number the same transfer lines on every route", () => {
    // Arrange
    const byArsId = new Map<string, string>();
    const mismatches: string[] = [];
    for (const route of jongroRoutes) {
      for (const [arsId, lines] of Object.entries(route.transferLinesByArsId)) {
        const seen = byArsId.get(arsId);
        if (seen === undefined) byArsId.set(arsId, JSON.stringify(lines));
        else if (seen !== JSON.stringify(lines)) mismatches.push(`${route.id} ${arsId}`);
      }
    }

    // Assert
    expect(mismatches).toEqual([]);
  });

  it("uses one color per subway line across every route", () => {
    // Arrange
    const colorByLine = new Map<string, Set<string>>();
    for (const route of jongroRoutes) {
      for (const t of Object.values(route.transferLinesByArsId).flat()) {
        if (!colorByLine.has(t.line)) colorByLine.set(t.line, new Set());
        colorByLine.get(t.line)!.add(t.color);
      }
    }

    // Assert
    expect([...colorByLine].filter(([, colors]) => colors.size > 1)).toEqual([]);
  });

  it("freezes each route and its transfer lines", () => {
    // Arrange
    const r = jongroRoutes[0]!;

    // Assert
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.transferLinesByArsId)).toBe(true);
    expect(() => {
      (r as { id: string }).id = "X";
    }).toThrow();
  });
});

describe("loadJongroRoutes validation (fail-loud surfaces)", () => {
  it("accepts the real shipped data with zero errors", () => {
    // Act & Assert
    expect(issuesOf(require("./jongro-routes.json"))).toEqual([]);
  });

  it("rejects non-array top-level", () => {
    // Act & Assert
    expect(issuesOf({ id: "jongro02" })[0]).toMatch(/must be a JSON array/);
  });

  it("rejects a route with a bad id pattern", () => {
    // Act & Assert
    expect(issuesOf(routeOf({ id: "jongroX" })).some((e) => e.includes("id: must match"))).toBe(true);
  });

  it("rejects a route that still lists stations as its transfer override", () => {
    // Act & Assert
    expect(issuesOf(routeOf({ transferLinesByArsId: undefined })).some((e) => e.includes("transferLinesByArsId"))).toBe(true);
  });
});
