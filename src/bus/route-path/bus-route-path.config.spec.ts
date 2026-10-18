/**
 * The committed route path snapshot (jongro-route-paths.seed.json) that seeds
 * a missing `jongro_route_paths` document and draws the map when the read
 * fails (add-jongro-route-lines D4, D5): it holds every configured route once
 * with the line and stations TOPIS answered on 2026-10-18, and a malformed
 * snapshot fails the boot with every issue, each with its path.
 */
import { jongroRoutes } from "../bus.config";
import { loadRoutePathsSeed, routePathsSeed } from "./bus-route-path.config";

const ROUTE_IDS = ["jongro99"];
const STATION = { topisId: "A", arsId: "01", stationName: "a", lng: 127, lat: 37.5, isTurnaround: false };
const entry = (overrides: Record<string, unknown> = {}) => ({ id: "jongro99", stations: [STATION], path: [[127, 37.5]], ...overrides });

function issuesOf(raw: unknown, routeIds: readonly string[] = ROUTE_IDS): string[] {
  try {
    loadRoutePathsSeed(raw, routeIds);
    return [];
  } catch (err) {
    return (err as Error).message.replace(/^jongro-route-paths\.seed\.json: /, "").split("; ");
  }
}

describe("routePathsSeed", () => {
  it("lists every configured route once, in the configured order", () => {
    // Act & Assert
    expect(routePathsSeed.map((seed) => seed.id)).toEqual(jongroRoutes.map((route) => route.id));
  });

  it("holds the 2026-10-18 answer: 252, 241 and 488 points; 27, 22 and 31 stations, one turnaround each", () => {
    // Act
    const counts = routePathsSeed.map((seed) => [seed.id, seed.path.length, seed.stations.length, seed.stations.filter((s) => s.isTurnaround).length]);

    // Assert
    expect(counts).toEqual([
      ["jongro02", 252, 27, 1],
      ["jongro07", 241, 22, 1],
      ["jongro08", 488, 31, 1],
    ]);
    expect(routePathsSeed[1]!.path[0]).toEqual([126.9921543446, 37.5881571127]);
  });

  it("is frozen", () => {
    // Act & Assert
    expect(Object.isFrozen(routePathsSeed[0]!.path[0])).toBe(true);
  });
});

describe("loadRoutePathsSeed", () => {
  it("accepts a well-formed snapshot", () => {
    // Act & Assert
    expect(issuesOf([entry()])).toEqual([]);
  });

  it("names a route the config lacks, a duplicate and a configured route with no snapshot", () => {
    // Act & Assert
    expect(issuesOf([entry(), entry(), entry({ id: "jongro98" })], ["jongro99", "jongro97"])).toEqual([
      '1.id: duplicate "jongro99"',
      '2.id: "jongro98" is no configured route',
      'root: no snapshot for "jongro97"',
    ]);
  });

  it("refuses an entry with no station or no point, and a station without a name", () => {
    // Act
    const issues = issuesOf([entry({ stations: [], path: [] }), entry({ id: "jongro99", stations: [{ ...STATION, stationName: "" }] })]);

    // Assert
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/^0\.stations: /), expect.stringMatching(/^0\.path: /), expect.stringMatching(/^1\.stations\.0\.stationName: /)]));
  });
});
