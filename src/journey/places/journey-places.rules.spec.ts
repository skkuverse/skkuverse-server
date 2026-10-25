/**
 * The place checks of a journey push (ADR 0022, D4): every cited place stands where its kind may (a route's ends a
 * building or stop area, a ride's stops a bus stop or subway station, a transfer at a station), resolves in its owning
 * catalog, has coords, and names a platform exactly where a subway station is boarded, alighted or changed at, one
 * of that station's; a catalog not read is a warning, and a stop area is refused until the planner resolves one.
 */
import { journeyRoutesFixture } from "../../../__tests__/helpers/journey/journey-routes";
import type { JourneyRoutesData } from "../journey.document";
import type { JourneyCatalog } from "../journey.types";
import { toPlaceIssues } from "./journey-places.rules";

const at = (lat: number, lng: number) => ({ lat, lng });
const STOPS = new Map([
  ["hssc-bus-lot", at(37.587367, 126.993643)],
  ["nsc-n-center", at(37.292298, 126.975057)],
  ["nsc-opposite", at(37.292536, 126.975077)],
  ["hssc-600th", at(37.587258, 126.993904)],
]);
const CATALOG: JourneyCatalog = {
  stopCoordsOf: (id) => STOPS.get(id),
  buildingCoords: new Map([
    ["1", at(37.584865, 126.997131)],
    ["7", at(37.290649, 126.974074)],
  ]),
  stationCoords: new Map([
    ["hyehwa", at(37.582336, 127.001844)],
    ["dogok", null],
  ]),
  platformIdsByStation: new Map([["hyehwa", new Set(["S1-4-420"])]]),
  sequencesByService: {},
};
const fixture = (): JourneyRoutesData => journeyRoutesFixture() as JourneyRoutesData;
const messages = (data: JourneyRoutesData, catalog = CATALOG) => toPlaceIssues(data, catalog).map((issue) => `${issue.path.join(".")}: ${issue.message}${issue.warning ? " (warning)" : ""}`);

/** Revision 1 with the HSSC route's first walk ending at `ref` and the ride boarding there, named `platformId`. */
function boardingAt(ref: string, platformId?: string): JourneyRoutesData {
  const data = fixture();
  const [walk, ride] = data.routes[0]!.options[0]!.legs;
  if (walk?.kind === "walk") walk.to = ref;
  if (ride?.kind === "ride") ride.board = { place: ref, ...(platformId && { platformId }) };
  return data;
}

describe("toPlaceIssues", () => {
  it("finds nothing in revision 1", () => {
    // Act & Assert
    expect(messages(fixture())).toEqual([]);
  });

  it.each([
    ["a stop bus-stops does not hold", boardingAt("bus_stop:nowhere"), 'routes.0.options.0.legs.0.to: "nowhere" is not a stop of bus-stops'],
    ["a station the checkout does not serve", boardingAt("subway_station:suwon", "X"), 'routes.0.options.0.legs.0.to: "suwon" is not a station the checked-out code serves'],
    ["a station without coords", boardingAt("subway_station:dogok", "X"), "routes.0.options.0.legs.0.to: subway_station:dogok has no coords in its catalog"],
    ["a boarded station without its platform", boardingAt("subway_station:hyehwa"), "routes.0.options.0.legs.1.board.place: subway_station:hyehwa is boarded or alighted, so it names its platform"],
    ["a platform of another station", boardingAt("subway_station:hyehwa", "KR-1-P153"), "routes.0.options.0.legs.1.board.place: KR-1-P153 is no platform of subway_station:hyehwa"],
    ["a platform on a bus stop", boardingAt("bus_stop:hssc-bus-lot", "S1-4-420"), "routes.0.options.0.legs.1.board.place: bus_stop:hssc-bus-lot names a platform, which only a boarded or alighted subway station does"],
    ["a building where a ride boards", boardingAt("skku_building:1"), "routes.0.options.0.legs.1.board.place: a skku_building cannot stand here; expected bus_stop or subway_station"],
    ["a stop area", boardingAt("bus_stop_area:hyehwa"), 'routes.0.options.0.legs.0.to: "hyehwa" is a stop area, which the planner does not resolve yet'],
  ])("refuses %s", (_case, data, expected) => {
    // Act & Assert
    expect(messages(data)).toContain(expected);
  });

  it("passes a boarded station named with its platform", () => {
    // Act & Assert
    expect(messages(boardingAt("subway_station:hyehwa", "S1-4-420"))).toEqual([]);
  });

  it("warns, refusing nothing, for buildings and stops not read", () => {
    // Act
    const lines = messages(fixture(), { ...CATALOG, buildingCoords: null, stopCoordsOf: null });

    // Assert
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.endsWith("(warning)"))).toBe(true);
  });
});
