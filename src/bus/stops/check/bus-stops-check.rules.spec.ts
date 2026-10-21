/**
 * toBusStopsIssues is every check a `bus-stops` push runs after its schema
 * (unify-bus-stops design D1 to D4; specs bus-schedule-config, bus-stops and
 * shuttle-arrival-eta): the catalog checks that stopped the boot of the
 * committed file, in their own words, the stop subway stations, the estimate
 * opt-ins, the lane strategies against the sequences the data estimates, the
 * HSSC line, and the aliases and overlay. Each issue names its path in the
 * dataset. Revision 1 (the fixture) has none.
 *
 * Ported from src/bus/stops/bus-stops.config.spec.ts (old → new): "throws on a
 * stop naming a station the registry does not serve, naming the stop and the
 * value" → "Unknown station stops the boot", and from bus-stops.schema.spec.ts
 * "fails the committed catalog with jeongja-exit2 naming the station jeongja2"
 * and "reports the station issue beside the other catalog issues, in one
 * parse" → the same scenario and "reports a catalog issue beside a station
 * issue"; the startup checks of `assertLaneStrategies` → "Strategy for an
 * unknown sequence".
 */
import { busStopsFixture } from "../../../../__tests__/helpers/bus/bus-stops";
import { SubwayStationsService } from "../../../subway/stations/subway-stations.service";
import { SERVICE_CONFIG } from "../../bus.constants";
import type { LaneStrategies } from "../../eta/lane/bus-eta-lane.types";
import type { BusStopsData } from "../bus-stops.document";
import { etaOptIns } from "../bus-stops.rules";
import { toBusStopsIssues } from "./bus-stops-check.rules";

const LANE: LaneStrategies = {
  "campus-inja": { regular: { strategy: "busLane", direction: "southbound" } },
};

const context = {
  knownServiceIds: new Set(Object.keys(SERVICE_CONFIG)),
  optIns: etaOptIns(SERVICE_CONFIG),
  stationIds: new Set(new SubwayStationsService().listStations().map((station) => station.id)),
  laneStrategies: LANE,
};

// The fixture as untyped JSON, so a test can break it.
const fixture = (): Record<string, any> => busStopsFixture();

const indexOfStop = (data: Record<string, any>, id: string): number => data.stops.findIndex((stop: { id: string }) => stop.id === id);

function withStop(id: string, patch: Record<string, unknown>): Record<string, any> {
  const data = fixture();
  const index = indexOfStop(data, id);
  data.stops[index] = { ...data.stops[index], ...patch };
  return data;
}

describe("toBusStopsIssues", () => {
  it("finds no issue in revision 1", () => {
    // Act & Assert
    expect(toBusStopsIssues(fixture() as BusStopsData, context)).toEqual([]);
  });

  it("Unknown stop referenced: names the service, the route type and the missing stop id", () => {
    // Arrange
    const data = fixture();
    data.sequences["commute-gangnam-yangjae"].down[1].stopId = "yangjae-exit9";

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
      { path: ["sequences", "commute-gangnam-yangjae", "down", 1], message: 'sequences commute-gangnam-yangjae.down[1]: unknown stop id "yangjae-exit9"' },
    ]);
  });

  it("Coordinates swapped: names the stop", () => {
    // Arrange
    const data = fixture();
    const index = indexOfStop(data, "jeongja-exit3");
    const { lat, lng } = data.stops[index].coords;
    data.stops[index].coords = { lat: lng, lng: lat };

    // Act
    const issues = toBusStopsIssues(data as BusStopsData, context);

    // Assert
    const atStop = issues.filter((issue) => issue.path.join(".") === `stops.${index}`);
    expect(atStop).toHaveLength(1);
    expect(atStop[0]!.message.split("; ")).toContain("stop jeongja-exit3: coords must be { lat, lng } inside South Korea (lat 33–39, lng 124–132)");
  });

  it("names every fault of one stop in the one issue at its path: bad coordinates, an off-host photo and a fov of 90", () => {
    // Arrange
    const data = fixture();
    const index = indexOfStop(data, "jeongja-exit3");
    const stop = data.stops[index];
    data.stops[index] = { ...stop, coords: { lat: stop.coords.lng, lng: stop.coords.lat }, photo: { original: "https://example.com/stop.jpg" }, panorama: { ...stop.panorama, fov: 90 } };

    // Act
    const atStop = toBusStopsIssues(data as BusStopsData, context).filter((issue) => issue.path.join(".") === `stops.${index}`);

    // Assert
    expect(atStop).toHaveLength(1);
    expect(atStop[0]!.message.split("; ")).toEqual(
      expect.arrayContaining([
        "stop jeongja-exit3: coords must be { lat, lng } inside South Korea (lat 33–39, lng 124–132)",
        "stop jeongja-exit3: photo.original is not a media.skkuverse.com URL",
        "stop jeongja-exit3: panorama.fov must be an integer in 25..80",
      ]),
    );
  });

  it("Photo on another host: names the stop", () => {
    // Arrange
    const data = withStop("jamsil-exit4", { photo: { original: "https://example.com/stop.jpg" } });

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", indexOfStop(data, "jamsil-exit4")], message: "stop jamsil-exit4: photo.original is not a media.skkuverse.com URL" }]);
  });

  it.each([
    [79, []],
    [80, []],
    [81, ["stop dogok-exit1: panorama.fov must be an integer in 25..80"]],
    [90, ["stop dogok-exit1: panorama.fov must be an integer in 25..80"]],
  ])("Field of view out of range: a panorama fov of %i gives %j", (fov, messages) => {
    // Arrange
    const data = fixture();
    const index = indexOfStop(data, "dogok-exit1");
    data.stops[index].panorama = { ...data.stops[index].panorama, fov };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual(messages.map((message) => ({ path: ["stops", index], message })));
  });

  it("A run nobody leaves: names the service and the route type", () => {
    // Arrange
    const data = fixture();
    for (const entry of data.sequences["campus-jain"].hakbu) entry.action = "board";

    // Act
    const issues = toBusStopsIssues(data as BusStopsData, context);

    // Assert
    expect(issues).toContainEqual({ path: ["sequences", "campus-jain", "hakbu"], message: "sequences campus-jain.hakbu: must have at least one alighting stop" });
  });

  it("Legacy fields left in the catalog: says the walk moved to guide", () => {
    // Arrange
    const data = withStop("gangnam-exit5", { walkPath: [] });

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", indexOfStop(data, "gangnam-exit5")], message: "stop gangnam-exit5: walkPath moved to guide (guide.places and guide.walks)" }]);
  });

  it("Unknown station stops the boot: names jeongja-exit2 and \"jeongja2\" at its station's path", () => {
    // Arrange
    const data = withStop("jeongja-exit2", { subwayStationId: "jeongja2" });

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
      { path: ["stops", indexOfStop(data, "jeongja-exit2"), "subwayStationId"], message: 'stop jeongja-exit2: subwayStationId "jeongja2" is not a served subway station' },
    ]);
  });

  it("reports a catalog issue beside a station issue, in one run", () => {
    // Arrange
    const data = withStop("jeongja-exit2", { subwayStationId: "jeongja2", name: {} });
    const index = indexOfStop(data, "jeongja-exit2");

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([
      { path: ["stops", index], message: "stop jeongja-exit2: name has no Korean text" },
      { path: ["stops", index, "subwayStationId"], message: 'stop jeongja-exit2: subwayStationId "jeongja2" is not a served subway station' },
    ]);
  });

  it("Two stops share an id: names the later one", () => {
    // Arrange
    const data = fixture();
    data.stops.push({ ...data.stops[0] });

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", data.stops.length - 1], message: "stop jeongja-exit3: duplicate id" }]);
  });

  it("Opted-in sequence without coordinates: names the service, the route type and the stop", () => {
    // Arrange
    const data = withStop("nsc-n-center", { coords: undefined });
    delete data.stops[indexOfStop(data, "nsc-n-center")].coords;

    // Act
    const issues = toBusStopsIssues(data as BusStopsData, context);

    // Assert
    expect(issues).toContainEqual({ path: ["sequences", "campus-inja", "regular", 1], message: "sequences campus-inja.regular[1]: opted in to estimates, but stop nsc-n-center has no coordinates" });
  });

  it("Strategy for an unknown sequence: names the sequence the strategy is set for", () => {
    // Arrange
    const data = fixture();
    delete data.sequences["campus-inja"].regular;

    // Act
    const issues = toBusStopsIssues(data as BusStopsData, context);

    // Assert
    expect(issues).toContainEqual({
      path: ["sequences", "campus-inja", "regular"],
      message: '"campus-inja regular" has a travel strategy in src/bus/eta/lane/bus-eta-lane.constants.ts, but this data does not estimate it',
    });
  });

  it("finds no lane issue for a strategy on an estimated sequence, and one for a sequence the code does not opt in", () => {
    // Arrange
    const strategies: LaneStrategies = { ...LANE, "fasttrack-inja": { regular: { strategy: "car" } } };

    // Act & Assert
    expect(toBusStopsIssues(fixture() as BusStopsData, { ...context, laneStrategies: strategies })).toEqual([
      {
        path: ["sequences", "fasttrack-inja", "regular"],
        message: '"fasttrack-inja regular" has a travel strategy in src/bus/eta/lane/bus-eta-lane.constants.ts, but this data does not estimate it',
      },
    ]);
  });

  it.each([
    [0, []],
    [1, [{ path: ["hssc", "stations", 1, "isFirstStation"], message: "only the first position may be the first station" }]],
    [10, [{ path: ["hssc", "stations", 10, "isFirstStation"], message: "only the first position may be the first station" }]],
  ])("an HSSC position %i flagged first gives %j", (index, expected) => {
    // Arrange
    const data = fixture();
    data.hssc.stations[index].isFirstStation = true;

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual(expected);
  });

  it.each([
    [10, []],
    [9, [{ path: ["hssc", "stations", 9, "isLastStation"], message: "only the last position may be the last station" }]],
    [0, [{ path: ["hssc", "stations", 0, "isLastStation"], message: "only the last position may be the last station" }]],
  ])("an HSSC position %i flagged last gives %j", (index, expected) => {
    // Arrange
    const data = fixture();
    data.hssc.stations[index].isLastStation = true;

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual(expected);
  });

  it("Unknown stop: names the HSSC position's path and the id", () => {
    // Arrange
    const data = fixture();
    data.stops.splice(indexOfStop(data, "hssc-main-gate-in"), 1);

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["hssc", "stations", 9, "stopId"], message: 'names the stop "hssc-main-gate-in", which the dataset\'s stops do not hold' }]);
  });

  it("Main gate inbound and outbound: two positions naming one stop name the later one", () => {
    // Arrange
    const data = fixture();
    data.hssc.stations[9].stopId = data.hssc.stations[2].stopId;

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["hssc", "stations", 9, "stopId"], message: 'names the stop "hssc-main-gate-out", which position 2 names too' }]);
  });

  it("One pole claimed twice: names both paths and 01618", () => {
    // Arrange
    const data = withStop("hssc-bus-lot", { arsIds: ["01618"] });
    const owner = indexOfStop(data, "hssc-bus-lot");
    const other = indexOfStop(data, "hssc-student-center");
    data.stops[other] = { ...data.stops[other], arsIds: ["01618"] };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["stops", other, "arsIds", 0], message: `ARS number 01618 is aliased by stops.${owner}.arsIds.0 too` }]);
  });

  it("passes two stops aliasing two different ARS numbers", () => {
    // Arrange
    const data = withStop("hssc-bus-lot", { arsIds: ["01618"] });
    const other = indexOfStop(data, "hssc-600th");
    data.stops[other] = { ...data.stops[other], arsIds: ["01616"] };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([]);
  });

  it("names an overlay entry's subway station the checked-out code does not serve", () => {
    // Arrange
    const data: Record<string, any> = { ...fixture(), topis: { "01592": { subwayStationId: "hyehwa" }, "01876": { subwayStationId: "hyehwa4" } } };

    // Act & Assert
    expect(toBusStopsIssues(data as BusStopsData, context)).toEqual([{ path: ["topis", "01876", "subwayStationId"], message: '"hyehwa4" is not a served subway station' }]);
  });
});
