/**
 * The `journey-routes` push checks of `npm run data` (scripts/lib/datasets/catalog.js; ADR 0013, D5; ADR 0022, D4),
 * against revision 1 of `bus-stops`, the stored subway station coords and the `buildings` collection as the tool hands
 * them to a check: revision 1 of the 인자셔틀 options passes and names its four stops as `bus-stops` references; a push
 * is refused for an unknown stop, a cited place without coords, an id outside `[a-z0-9-]{1,128}`, a reversed stop
 * pair, legs that do not chain, a ride on no line and a stop where only a building or stop area may stand; and a
 * `bus-stops` push that drops a cited stop is refused while the journey dataset names it. Against the stored
 * `subway-timetables` too, revision 2's 4호선 → 금정 → 1호선 options pass; a ride is refused for a platform of another
 * station, a platform on another line than the ride's, and platforms no train of a day type runs between in order; with
 * no stored timetables the train order is a warning, not a refusal.
 */
import path from "path";
import { storedJongroRouteDocuments } from "../../helpers/bus/bus-registry";
import { storedJongroRoutePathDocuments } from "../../helpers/bus/bus-route-path";
import { registryDoc7800 } from "../../helpers/bus/topis-7800";
import { subwayTimetablesFixture } from "../../helpers/subway/timetables";

const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");
const { checkContent, checkData } = require("../../../scripts/lib/datasets/checks");

const SRC = path.join(__dirname, "../../../src");
const srcLoader = (relativePath: string): unknown => require(path.join(SRC, relativePath));

/** A dataset fixture's data, as the push imports it: a fresh copy without `_about`. */
function datasetFixture(relativePath: string): any {
  const { _about: note, ...data } = structuredClone(require(relativePath)) as Record<string, unknown>;
  void note;
  return data;
}

const journeyRoutes = () => datasetFixture("./fixtures/journey-routes.dataset.json");
const stored = () => ({
  "bus-stops": datasetFixture("../bus/fixtures/bus-stops.dataset.json"),
  "subway-station-coords": datasetFixture("../subway/fixtures/subway-station-coords.dataset.json"),
});
const gate = (id: number, lng: number, lat: number) => ({ _id: id, location: { type: "Point", coordinates: [lng, lat] } });
const BUILDINGS = [gate(1, 126.997131, 37.584865), gate(7, 126.974074, 37.290649)];

type Issue = { dataset: string; path: Array<string | number>; message: string };
const issueLines = (issues: Issue[]): string[] => issues.map((issue) => `${issue.dataset}: ${issue.path.join(".")}: ${issue.message}`);
const check = (data: unknown, buildings: unknown[] = BUILDINGS) => issueLines(checkData(loadCatalog(srcLoader), "journey-routes", data, stored(), { buildings }));

describe("loadCatalog journey-routes", () => {
  it("is owned by src/journey and accepts revision 1, naming its four stops as bus-stops references", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["journey-routes"];

    // Act
    const lines = check(journeyRoutes());

    // Assert
    expect(entry.owner).toBe("src/journey");
    expect(lines).toEqual([]);
    expect(entry.referencesOf(entry.schema.parse(journeyRoutes())).map((ref: { dataset: string; id: string }) => `${ref.dataset}:${ref.id}`)).toEqual([
      "bus-stops:hssc-bus-lot",
      "bus-stops:hssc-bus-lot",
      "bus-stops:nsc-n-center",
      "bus-stops:nsc-n-center",
      "bus-stops:nsc-opposite",
      "bus-stops:nsc-opposite",
      "bus-stops:hssc-600th",
      "bus-stops:hssc-600th",
    ]);
  });

  it("Unknown stop: refuses a ride that boards at a stop bus-stops does not hold", () => {
    // Arrange
    const data = journeyRoutes();
    data.routes[0].options[0].legs[0].to = "bus_stop:hssc-nowhere";
    data.routes[0].options[0].legs[1].board.place = "bus_stop:hssc-nowhere";

    // Act
    const lines = check(data);

    // Assert
    expect(lines).toEqual(expect.arrayContaining(['journey-routes: routes.0.options.0.legs.1.board.place: "hssc-nowhere" is not a stop of bus-stops']));
  });

  it("Missing coords: refuses a cited building stored without a point", () => {
    // Act
    const lines = check(journeyRoutes(), [BUILDINGS[0], { _id: 7 }]);

    // Assert
    expect(lines).toEqual(expect.arrayContaining(["journey-routes: routes.0.to: skku_building:7 has no coords in its catalog"]));
  });

  it("refuses a cited building the collection does not hold", () => {
    // Act
    const lines = check(journeyRoutes(), [BUILDINGS[0]]);

    // Assert
    expect(lines).toEqual(expect.arrayContaining(['journey-routes: routes.0.to: "7" is not a stored building']));
  });

  it("Bad id: refuses a route id outside [a-z0-9-]{1,128} and a place id with an uppercase letter", () => {
    // Arrange
    const data = journeyRoutes();
    data.routes[0].id = "HSSC_to_NSC";
    data.routes[1].from = "skku_building:Main";

    // Act
    const lines = check(data);

    // Assert
    expect(lines).toEqual([
      "journey-routes: routes.0.id: must be 1-128 characters of a-z, 0-9 and -",
      "journey-routes: routes.1.from: must be <kind>:<id>, kind one of bus_stop, bus_stop_area, subway_station, skku_building and id 1-128 characters of a-z, 0-9 and -",
    ]);
  });

  it("Reversed pair: refuses a ride that boards at the alighting stop", () => {
    // Arrange
    const data = journeyRoutes();
    const [walkIn, ride, walkOut] = data.routes[0].options[0].legs;
    walkIn.to = "bus_stop:nsc-n-center";
    ride.board.place = "bus_stop:nsc-n-center";
    ride.alight.place = "bus_stop:hssc-bus-lot";
    walkOut.from = "bus_stop:hssc-bus-lot";

    // Act
    const lines = check(data);

    // Assert
    expect(lines).toEqual(["journey-routes: routes.0.options.0.legs.1: campus-inja has no sequence that boards at nsc-n-center and then alights at hssc-bus-lot"]);
  });

  it("refuses legs that do not chain, a ride on no line, and a stop where only a building or stop area may stand", () => {
    // Arrange
    const data = journeyRoutes();
    data.routes[0].options[0].legs[2].from = "bus_stop:nsc-opposite";
    data.routes[1].options[0].legs[1].line = "jain-express";
    data.lines.push({ ...data.lines[0] });

    // Act
    const lines = check({ ...data, routes: [...data.routes, { ...data.routes[0], id: "stop-to-gate", from: "bus_stop:hssc-bus-lot", options: [{ ...data.routes[0].options[0], legs: data.routes[0].options[0].legs.slice(1) }] }] });

    // Assert
    expect(lines).toEqual(
      expect.arrayContaining([
        'journey-routes: lines.2.id: "inja" is used twice',
        "journey-routes: routes.0.options.0.legs.2: starts at bus_stop:nsc-opposite, not at bus_stop:nsc-n-center, where the option is by then",
        'journey-routes: routes.1.options.0.legs.1.line: "jain-express" is no line of this dataset',
        "journey-routes: routes.2.from: a bus_stop cannot stand here; expected skku_building or bus_stop_area",
      ]),
    );
  });

  it("Reordered sequence: refuses a bus-stops push that leaves a cited ride's stops out of order, rechecking journey-routes", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const busStops = stored()["bus-stops"];
    for (const sequence of Object.values(busStops.sequences["campus-jain"] as Record<string, Array<{ stopId?: string }>>)) sequence.reverse();

    // Act
    const lines = issueLines(checkData(catalog, "bus-stops", busStops, { ...stored(), "journey-routes": journeyRoutes() }, { busSchedules: null, buildings: BUILDINGS }));

    // Assert
    expect(lines).toEqual(expect.arrayContaining(["journey-routes: routes.1.options.0.legs.1: campus-jain has no sequence that boards at nsc-opposite and then alights at hssc-600th"]));
  });

  describe("an unlisted route's pole, cited by its station id, which only the alias of a catalog stop lets into the stop index (ADR 0022, D4)", () => {
    const proposal = (require("../bus/fixtures/bus-stops-7800-proposal.json") as { stops: Array<Record<string, unknown>> }).stops;
    const withPoles = () => ({ ...stored(), "bus-stops": { ...stored()["bus-stops"], stops: [...stored()["bus-stops"].stops, ...structuredClone(proposal)] } });
    const topis = () => ({ jongroRoutes: [...storedJongroRouteDocuments(), registryDoc7800()], jongroRoutePaths: storedJongroRoutePathDocuments(), buildings: BUILDINGS });
    // 7800's 사당역 9번출구 pole (station 119000302, ARS 20253), a walk end on the way to the shuttle.
    const citingPole = (poleId = "119000302") => {
      const data = journeyRoutes();
      const [walkIn] = data.routes[0].options[0].legs;
      data.routes[0].options[0].legs.splice(0, 1, { ...walkIn, to: `bus_stop:${poleId}` }, { ...walkIn, from: `bus_stop:${poleId}` });
      return data;
    };

    it("resolves the pole through the stop index while sadang-exit9 aliases it", () => {
      // Act
      const lines = issueLines(checkData(loadCatalog(srcLoader), "journey-routes", citingPole(), withPoles(), topis()));

      // Assert
      expect(lines).toEqual([]);
    });

    it("still accepts the pole's legacy seoul-<ARS> alias (ADR 0019, D5)", () => {
      // Act
      const lines = issueLines(checkData(loadCatalog(srcLoader), "journey-routes", citingPole("seoul-20253"), withPoles(), topis()));

      // Assert
      expect(lines).toEqual([]);
    });

    it("refuses a bus-stops push that drops the alias, rechecking journey-routes", () => {
      // Arrange
      const busStops = withPoles()["bus-stops"];
      delete busStops.stops.find((stop: { id: string }) => stop.id === "sadang-exit9").arsIds;

      // Act
      const lines = issueLines(checkData(loadCatalog(srcLoader), "bus-stops", busStops, { ...withPoles(), "journey-routes": citingPole() }, { ...topis(), busSchedules: null }));

      // Assert
      expect(lines).toEqual(['journey-routes: routes.0.options.0.legs.0.to: "119000302" is not a stop of bus-stops', 'journey-routes: routes.0.options.0.legs.1.from: "119000302" is not a stop of bus-stops']);
    });
  });

  it("refuses a bus-stops push that drops a stop the journey dataset cites", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const busStops = stored()["bus-stops"];
    busStops.stops = busStops.stops.filter((stop: { id: string }) => stop.id !== "hssc-600th");
    busStops.sequences["campus-jain"] = Object.fromEntries(
      Object.entries(busStops.sequences["campus-jain"] as Record<string, Array<{ stopId?: string }>>).map(([routeType, sequence]) => [routeType, sequence.map((stop) => (stop.stopId === "hssc-600th" ? { ...stop, stopId: "hssc-bus-lot" } : stop))]),
    );

    // Act
    const lines = issueLines(checkData(catalog, "bus-stops", busStops, { ...stored(), "journey-routes": journeyRoutes() }, { busSchedules: [] }));

    // Assert
    expect(lines).toEqual(expect.arrayContaining(['journey-routes: routes.1.options.0.legs.1.alight.place: "hssc-600th" is no longer in bus-stops']));
  });
});

describe("loadCatalog journey-routes with the subway options", () => {
  const revision2 = () => datasetFixture("./fixtures/journey-routes-revision-2.dataset.json");
  // WHY: as the tool hands a parted dataset to a check: its manifest's parts, each with its data.
  const storedTables = (tables = subwayTimetablesFixture()) => ({ parts: tables.map((table) => ({ key: `${table.operator}-${table.line}-${table.dayType}`, data: table })) });
  const withTimetables = () => ({ ...stored(), "subway-timetables": storedTables() });
  const checkSubway = (data: unknown, storedData: Record<string, unknown> = withTimetables()) => issueLines(checkData(loadCatalog(srcLoader), "journey-routes", data, storedData, { buildings: BUILDINGS }));
  const toNscLegs = (data: any) => data.routes[0].options[1].legs;

  it("accepts revision 2, the 4호선 → 금정 → 1호선 option each way", () => {
    // Act
    const lines = checkSubway(revision2());

    // Assert
    expect(lines).toEqual([]);
  });

  it("Wrong platform: refuses a ride that boards at a platform of another station", () => {
    // Arrange
    const data = revision2();
    toNscLegs(data)[1].board.platformId = "KR-1-P153";

    // Act
    const lines = checkSubway(data);

    // Assert
    expect(lines).toEqual(expect.arrayContaining(["journey-routes: routes.0.options.1.legs.1.board.place: KR-1-P153 is no platform of subway_station:hyehwa"]));
  });

  it("refuses a 4호선 ride that alights at 금정's 1호선 platform", () => {
    // Arrange
    const data = revision2();
    toNscLegs(data)[1].alight.platformId = "KR-1-P149";

    // Act
    const lines = checkSubway(data);

    // Assert
    expect(lines).toEqual(["journey-routes: routes.0.options.1.legs.1: KR-1-P149 is a platform of line 1, not of line 4"]);
  });

  it("refuses a ride whose platforms no train runs between in order, with the stored tables", () => {
    // Arrange
    const data = revision2();
    const tables = subwayTimetablesFixture().map((table) => (table.operator === "KR" && table.line === "1" ? { ...table, trains: table.trains.filter((train) => train.direction === "up") } : table));

    // Act
    const lines = checkSubway(data, { ...withTimetables(), "subway-timetables": storedTables(tables) });

    // Assert
    expect(lines).toEqual(["journey-routes: routes.0.options.1.legs.3: no weekday train runs from KR-1-P149 to KR-1-P153"]);
  });

  it("checks no train order with no stored subway-timetables, and refuses nothing for it", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const { issues, warnings } = checkContent(catalog, "journey-routes", revision2(), stored(), { buildings: BUILDINGS });

    // Assert
    expect(issues).toEqual([]);
    expect(issueLines(warnings)).toEqual([
      "journey-routes: routes.0.options.1.legs.1.line: no stored subway-timetables, so the ride's train order was not checked",
      "journey-routes: routes.0.options.1.legs.3.line: no stored subway-timetables, so the ride's train order was not checked",
      "journey-routes: routes.1.options.1.legs.1.line: no stored subway-timetables, so the ride's train order was not checked",
      "journey-routes: routes.1.options.1.legs.3.line: no stored subway-timetables, so the ride's train order was not checked",
    ]);
  });
});
