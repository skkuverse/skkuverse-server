/**
 * What the journey dataset decides whatever its places resolve to (ADR 0022, D4 and D5): a place ref read apart into
 * its kind and the catalog's id, a leg's two ends, every cited place with its role, the cited stops as bus-stops
 * references, and the push issues of ids used twice, legs that do not chain from the route's from to its to, a ride on
 * no line, and a timetabled ride whose stops no sequence boards and alights in that order.
 */
import { journeyRoutesFixture } from "../../__tests__/helpers/journey/journey-routes";
import type { JourneyRoutesData } from "./journey.document";
import { journeyRoutesReferences, toCitedPlaces, toJourneyRoutesIssues, toLegEnds, toPlaceRef } from "./journey.rules";
import type { JourneyCatalog } from "./journey.types";

const fixture = (): JourneyRoutesData => journeyRoutesFixture() as JourneyRoutesData;
const sequence = (board: string, alight: string) => [
  { stopId: board, action: "board" as const },
  { stopId: alight, action: "alight" as const },
];
const CATALOG: JourneyCatalog = {
  stopCoordsOf: () => null,
  buildingCoords: null,
  stationCoords: new Map(),
  platformIdsByStation: new Map(),
  sequencesByService: { "campus-inja": { regular: sequence("hssc-bus-lot", "nsc-n-center") }, "campus-jain": { regular: sequence("nsc-opposite", "hssc-600th") } },
};
const messages = (data: JourneyRoutesData, catalog = CATALOG) => toJourneyRoutesIssues(data, catalog).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

describe("toPlaceRef", () => {
  it.each([
    ["bus_stop:hssc-bus-lot", { kind: "bus_stop", id: "hssc-bus-lot" }],
    ["skku_building:1", { kind: "skku_building", id: "1" }],
    ["subway_station:01616", { kind: "subway_station", id: "01616" }],
    ["campus_gate:1", null],
    ["bus_stop:Hssc", null],
    ["hssc-bus-lot", null],
  ])("reads %s", (ref, expected) => {
    // Act & Assert
    expect(toPlaceRef(ref)).toEqual(expected);
  });
});

describe("toLegEnds", () => {
  it("is a walk's from and to, a transfer's station twice and a ride's board and alight", () => {
    // Arrange
    const transfer = { kind: "transfer" as const, at: "subway_station:geumjeong", fromPlatformId: "A", toPlatformId: "B", minutes: 3, evidence: "x" };

    // Act & Assert
    expect(fixture().routes[0]!.options[0]!.legs.map(toLegEnds)).toEqual([
      { from: "skku_building:1", to: "bus_stop:hssc-bus-lot" },
      { from: "bus_stop:hssc-bus-lot", to: "bus_stop:nsc-n-center" },
      { from: "bus_stop:nsc-n-center", to: "skku_building:7" },
    ]);
    expect(toLegEnds(transfer)).toEqual({ from: "subway_station:geumjeong", to: "subway_station:geumjeong" });
  });
});

describe("toCitedPlaces", () => {
  it("lists each route end, walk end and ride stop of revision 1 with its role and path", () => {
    // Act
    const cited = toCitedPlaces(fixture()).filter(({ path }) => path[1] === 0);

    // Assert
    expect(cited.map(({ ref, role, path }) => [ref, role, path.join(".")])).toEqual([
      ["skku_building:1", "routeEnd", "routes.0.from"],
      ["skku_building:7", "routeEnd", "routes.0.to"],
      ["skku_building:1", "walkEnd", "routes.0.options.0.legs.0.from"],
      ["bus_stop:hssc-bus-lot", "walkEnd", "routes.0.options.0.legs.0.to"],
      ["bus_stop:hssc-bus-lot", "rideStop", "routes.0.options.0.legs.1.board.place"],
      ["bus_stop:nsc-n-center", "rideStop", "routes.0.options.0.legs.1.alight.place"],
      ["bus_stop:nsc-n-center", "walkEnd", "routes.0.options.0.legs.2.from"],
      ["skku_building:7", "walkEnd", "routes.0.options.0.legs.2.to"],
    ]);
  });
});

describe("journeyRoutesReferences", () => {
  it("names each cited stop as a bus-stops identity, and no building", () => {
    // Act
    const references = journeyRoutesReferences(fixture());

    // Assert
    expect(new Set(references.map(({ dataset, id }) => `${dataset}:${id}`))).toEqual(new Set(["bus-stops:hssc-bus-lot", "bus-stops:nsc-n-center", "bus-stops:nsc-opposite", "bus-stops:hssc-600th"]));
  });
});

describe("toJourneyRoutesIssues", () => {
  it("finds nothing in revision 1", () => {
    // Act & Assert
    expect(messages(fixture())).toEqual([]);
  });

  it("refuses an option id used twice in a route, and allows one route's option id in another", () => {
    // Arrange
    const data = fixture();
    data.routes[0]!.options.push(structuredClone(data.routes[0]!.options[0]!));

    // Act & Assert
    expect(messages(data)).toEqual(['routes.0.options.1.id: "inja" is used twice']);
  });

  it("refuses an option that ends short of the route's to", () => {
    // Arrange
    const data = fixture();
    data.routes[0]!.options[0]!.legs.pop();

    // Act & Assert
    expect(messages(data)).toEqual(["routes.0.options.0.legs: ends at bus_stop:nsc-n-center, not at the route's skku_building:7"]);
  });

  it("warns, refusing nothing, when no bus-stops is stored to check a ride's order against", () => {
    // Act
    const issues = toJourneyRoutesIssues(fixture(), { ...CATALOG, sequencesByService: null });

    // Assert
    expect(issues.every((issue) => issue.warning)).toBe(true);
    expect(issues).toHaveLength(2);
  });

  it("refuses a ride whose alight is the sequence's boarding stop", () => {
    // Arrange
    const catalog = { ...CATALOG, sequencesByService: { ...CATALOG.sequencesByService, "campus-inja": { regular: sequence("nsc-n-center", "hssc-bus-lot") } } };

    // Act & Assert
    expect(messages(fixture(), catalog)).toEqual(["routes.0.options.0.legs.1: campus-inja has no sequence that boards at hssc-bus-lot and then alights at nsc-n-center"]);
  });
});
