/**
 * The committed station snapshot (jongro-stations.seed.json) that seeds a
 * missing registry document: it lists every configured route once, in TOPIS
 * order with its turnaround stop, and a malformed snapshot fails the boot
 * with every issue, each with its path (improve-jongro-realtime D6).
 */
import { jongroRoutes } from "../bus.config";
import { loadStationsSeed, stationsSeed } from "./bus-registry.config";

const ROUTE_IDS = ["jongro99"];
const stn = (topisId: string) => ({ topisId, arsId: `0${topisId}`, stationName: `stop ${topisId}` });
const entry = (overrides: Record<string, unknown> = {}) => ({ id: "jongro99", turnaroundTopisId: "B", stations: [stn("A"), stn("B"), stn("C")], ...overrides });

function issuesOf(raw: unknown, routeIds: readonly string[] = ROUTE_IDS): string[] {
  try {
    loadStationsSeed(raw, routeIds);
    return [];
  } catch (err) {
    return (err as Error).message.replace(/^jongro-stations\.seed\.json: /, "").split("; ");
  }
}

describe("stationsSeed", () => {
  it("lists every configured route once, in the committed order", () => {
    // Act & Assert
    expect(stationsSeed.map((seed) => seed.id)).toEqual(jongroRoutes.map((route) => route.id));
  });

  it("holds the stations of 2026-10-17: 02 = 27 with its loop close, 07 = 22, 08 = 31", () => {
    // Arrange
    const byId = new Map(stationsSeed.map((seed) => [seed.id, seed]));
    const r02 = byId.get("jongro02")!;

    // Assert
    expect(r02.stations).toHaveLength(27);
    expect(r02.stations[0]).toEqual({ topisId: "100900204", arsId: "01881", stationName: "성균관대학교" });
    expect(r02.stations[26]).toEqual(r02.stations[0]);
    expect(byId.get("jongro07")!.stations).toHaveLength(22);
    expect(byId.get("jongro08")!.stations).toHaveLength(31);
  });

  it("names each route's turnaround stop, which the 2026-10-17 position rows agreed with", () => {
    // Act & Assert
    expect(stationsSeed.map((seed) => [seed.id, seed.turnaroundTopisId])).toEqual([
      ["jongro02", "100900121"],
      ["jongro07", "100900028"],
      ["jongro08", "100000153"],
    ]);
  });

  it("is frozen", () => {
    // Act & Assert
    expect(Object.isFrozen(stationsSeed[0]!.stations[0])).toBe(true);
  });
});

describe("loadStationsSeed", () => {
  it("accepts a well-formed snapshot", () => {
    // Act & Assert
    expect(issuesOf([entry()])).toEqual([]);
  });

  it("accepts the last stop repeating the first (TOPIS loop close)", () => {
    // Act & Assert
    expect(issuesOf([entry({ stations: [stn("A"), stn("B"), stn("A")] })])).toEqual([]);
  });

  it("rejects a non-array snapshot", () => {
    // Act & Assert
    expect(issuesOf({ id: "jongro99" })).toEqual(["root: Invalid input: expected array, received object"]);
  });

  it.each([
    ["no stations", entry({ stations: [] }), "0.stations: required non-empty array"],
    ["an empty station field", entry({ stations: [stn("A"), { ...stn("B"), arsId: "" }] }), "0.stations.1.arsId: required non-empty string"],
    ["a stop repeated mid-route", entry({ stations: [stn("A"), stn("B"), stn("B")] }), '0.stations.2.topisId: duplicate "B" within route'],
    ["a turnaround stop off the route", entry({ turnaroundTopisId: "Z" }), '0.turnaroundTopisId: "Z" is no station of the route'],
  ])("rejects %s", (_case, raw, message) => {
    // Act & Assert
    expect(issuesOf([raw])).toEqual([message]);
  });

  it("names a configured route the snapshot lacks and one it does not configure", () => {
    // Act & Assert
    expect(issuesOf([entry({ id: "jongro98" })])).toEqual(['0.id: "jongro98" is no configured route', 'root: no snapshot for "jongro99"']);
  });

  it("reports every issue of a snapshot in one boot", () => {
    // Act & Assert
    expect(issuesOf([entry({ stations: [] }), entry()], ["jongro99"])).toEqual([
      "0.stations: required non-empty array",
      '1.id: duplicate "jongro99"',
    ]);
  });
});
