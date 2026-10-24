/**
 * The route the registry derives from a stored document and the route's
 * identity in code: served stations with their ends and the turnaround stop,
 * and the TOPIS id → first ord mapping that places a bus. The transfer lines
 * are stored attributes the config view joins (ADR 0013, D2).
 */
import { JONGRO_ROUTES } from "../bus.constants";
import type { JongroRoute } from "../bus.types";
import type { JongroRouteDocument } from "./bus-registry.document";
import { toRegistryRoute, toRegistryStations } from "./bus-registry.mapper";


const committed: JongroRoute = JONGRO_ROUTES.find((route) => route.id === "jongro07")!;

const documentOf = (topisIds: string[], overrides: Partial<JongroRouteDocument> = {}): JongroRouteDocument => ({
  _id: "jongro07",
  stations: topisIds.map((topisId, index) => ({ topisId, arsId: `ars-${topisId}`, stationName: `stop ${topisId}`, sequence: index + 1 })),
  turnaroundTopisId: topisIds[1] ?? "",
  stationsVersion: "0123456789abcdef",
  syncedAt: new Date("2026-10-17T12:00:00Z"),
  ...overrides,
});

describe("toRegistryRoute", () => {
  it("keeps the committed fields and adds the stored version, turnaround stop and stations", () => {
    // Act
    const route = toRegistryRoute(committed, documentOf(["A", "B", "C"]));

    // Assert
    expect(route).toMatchObject({ id: "jongro07", code: "07", busRouteId: "100900004", stationsVersion: "0123456789abcdef", turnaroundTopisId: "B" });
    expect(route).not.toHaveProperty("seatCount");
    expect(route.topisIds).toEqual(["A", "B", "C"]);
  });

  it("serves the first and last stored stations as the ends and the turnaround stop as the rotation", () => {
    // Act
    const { stations } = toRegistryRoute(committed, documentOf(["A", "B", "C"]));

    // Assert
    expect(stations.map((s) => [s.sequence, s.stationName, s.stationNumber, s.isFirstStation, s.isLastStation, s.isRotationStation])).toEqual([
      ["1", "stop A", "ars-A", true, false, false],
      ["2", "stop B", "ars-B", false, false, true],
      ["3", "stop C", "ars-C", false, true, false],
    ]);
  });

  // A bus whose last passed stop is the terminal has just left it, so the
  // loop-closing repeat must not steal the mapping from ord 1.
  it("maps a loop-closing repeat to its first ord, and lists every ord in topisIds", () => {
    // Act
    const { mapping, topisIds } = toRegistryRoute(committed, documentOf(["A", "B", "A"]));

    // Assert
    expect(mapping["A"]).toEqual({ sequence: 1, stationName: "stop A" });
    expect(topisIds).toEqual(["A", "B", "A"]);
  });

  it("maps no TOPIS id the registry does not list, Object.prototype names included", () => {
    // Act
    const { mapping } = toRegistryRoute(committed, documentOf(["100900204", "100900197"]));

    // Assert
    expect(mapping["constructor"]).toBeUndefined();
    expect(mapping["toString"]).toBeUndefined();
    expect(mapping["100900197"]).toEqual({ sequence: 2, stationName: "stop 100900197" });
  });

  it("maps a listed TOPIS id that names an Object.prototype member", () => {
    // Act
    const { mapping } = toRegistryRoute(committed, documentOf(["100900204", "constructor"]));

    // Assert
    expect(mapping["constructor"]).toEqual({ sequence: 2, stationName: "stop constructor" });
  });

  // WHY: stops away leave out the stations a bus passes without stopping (ADR 0019, D4), which TOPIS names `…(미정차)`.
  it("derives the ords of the stored stations a bus passes through, whatever ARS number they carry", () => {
    // Arrange
    const doc = documentOf(["A", "B", "C", "D", "E"]);
    doc.stations[1]!.stationName = "효행공원(미정차)";
    doc.stations[2]!.stationName = "사당역사거리(미정차)";
    doc.stations[2]!.arsId = "78420";

    // Act
    const { passThroughOrds } = toRegistryRoute(committed, doc);

    // Assert
    expect([...passThroughOrds]).toEqual([2, 3]);
  });

  it("derives no pass-through ord on a route that stops everywhere", () => {
    // Act & Assert
    expect(toRegistryRoute(committed, documentOf(["A", "B", "C"])).passThroughOrds.size).toBe(0);
  });
});

describe("toRegistryStations", () => {
  it("numbers the observed stations by their ord", () => {
    // Act & Assert
    expect(toRegistryStations([{ topisId: "A", arsId: "1", stationName: "a" }, { topisId: "B", arsId: "2", stationName: "b" }])).toEqual([
      { topisId: "A", arsId: "1", stationName: "a", sequence: 1 },
      { topisId: "B", arsId: "2", stationName: "b", sequence: 2 },
    ]);
  });
});
