/**
 * The lane config's rules: the travel strategy a sequence takes (`car` unless the config names it), the configured
 * sequences the app does not estimate, and the cross-checks a well-typed corridor must still pass. Then which runs
 * are bus-lane runs, and where a direction's entry and exit lie along the corridor.
 *
 * The strategies and lane hours are code (move-reference-datasets D9): `assertLaneStrategies` is the check
 * BusEtaLaneService's construction runs over them against the sequences the app estimates, so a bad constant fails
 * the boot, naming every issue. `corridorIssues` is what a `bus-lane-corridor` push is refused on beyond its schema
 * (spec "Corridor push checks the geometry"), including each entry and exit point's distance from the centerline
 * and each direction's order along it; the lane hours are no longer corridor data.
 */
import { corridorFixture } from "../../../../__tests__/helpers/bus/bus-lane-corridor";
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import { SubwayStationsService } from "../../../subway/stations/subway-stations.service";
import type { BusScheduleService } from "../../schedule/bus-schedule.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import type { BusEtaRepository } from "../bus-eta.repository";
import { BusEtaService } from "../bus-eta.service";
import { LANE_HOURS, LANE_STRATEGIES } from "./bus-eta-lane.constants";
import { assertLaneStrategies, corridorIssues, strategyIssues, strategyOf, strategyOfRun, toLegBounds } from "./bus-eta-lane.rules";
import type { LaneConfigFile as LaneConfig } from "./bus-eta-lane.schema";

const estimatedSequences = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), {} as BusScheduleService, new BusStopsService(new SubwayStationsService())).sequences();

const STRATEGIES: LaneConfig["strategies"] = {
  "campus-inja": { regular: { strategy: "busLane", direction: "southbound" } },
  "campus-jain": { regular: { strategy: "busLane", direction: "northbound" }, hakbu: { strategy: "car" } },
};

// Three vertices 0.01° of latitude apart: about 1,111.95 m each on a 6,371 km sphere.
const STEP_M = (6_371_000 * 0.01 * Math.PI) / 180;
// The centerline's length rounded to the meter, as the corridor script writes its last boundary.
const END_M = Math.round(2 * STEP_M);
// One degree of longitude at 37.48° N, the centerline's south end, on the same sphere, as the projection flattens it there.
const LNG_DEGREE_M = ((6_371_000 * Math.PI) / 180) * Math.cos((37.48 * Math.PI) / 180);

function config(overrides: Partial<LaneConfig> = {}): LaneConfig {
  return {
    laneHours: { from: "07:00", to: "21:00" },
    strategies: STRATEGIES,
    corridor: {
      centerline: [
        { lat: 37.5, lng: 127.02 },
        { lat: 37.49, lng: 127.02 },
        { lat: 37.48, lng: 127.02 },
      ],
      boundaries: [
        { name: "north", alongM: 0 },
        { name: "middle", alongM: 1000 },
        { name: "south", alongM: END_M },
      ],
    },
    entryExit: {
      southbound: { entry: { lat: 37.5, lng: 127.02 }, exit: { lat: 37.48, lng: 127.02 } },
      northbound: { entry: { lat: 37.48, lng: 127.02 }, exit: { lat: 37.5, lng: 127.02 } },
    },
    probeRoutes: [
      { routeId: "200000205", name: "8800", sectOrds: { southbound: { from: 45, to: 56 }, northbound: { from: 15, to: 27 } } },
      { routeId: "228000174", name: "5000", sectOrds: { southbound: { from: 74, to: 86 }, northbound: { from: 41, to: 53 } } },
    ],
    ...overrides,
  };
}

function withBoundaries(boundaries: LaneConfig["corridor"]["boundaries"]): LaneConfig {
  const base = config();
  return { ...base, corridor: { ...base.corridor, boundaries } };
}

describe("strategyOf", () => {
  it("returns a configured bus-lane sequence's strategy with its direction", () => {
    // Act
    const strategy = strategyOf(STRATEGIES, { serviceId: "campus-jain", routeType: "regular" });

    // Assert
    expect(strategy).toEqual({ strategy: "busLane", direction: "northbound" });
  });

  it.each([
    ["a service the config does not name", "commute-jamsil", "down"],
    ["a route type its service leaves out", "campus-inja", "hakbu"],
  ])("resolves %s to car", (_case, serviceId, routeType) => {
    // Act
    const strategy = strategyOf(STRATEGIES, { serviceId, routeType });

    // Assert
    expect(strategy).toEqual({ strategy: "car" });
  });

  it("returns car where the config says car", () => {
    // Act
    const strategy = strategyOf(STRATEGIES, { serviceId: "campus-jain", routeType: "hakbu" });

    // Assert
    expect(strategy).toEqual({ strategy: "car" });
  });
  it("gives each sequence the app estimates today's strategy: the shuttle between campuses on the bus lane, the commute shuttle by car", () => {
    // Act
    const strategies = estimatedSequences.map((s) => [s.serviceId, s.routeType, strategyOf(LANE_STRATEGIES, s)]);

    // Assert
    expect(strategies).toEqual([
      ["campus-inja", "regular", { strategy: "busLane", direction: "southbound" }],
      ["campus-inja", "hakbu", { strategy: "busLane", direction: "southbound" }],
      ["campus-jain", "regular", { strategy: "busLane", direction: "northbound" }],
      ["campus-jain", "hakbu", { strategy: "busLane", direction: "northbound" }],
      ...["jeongja", "jamsil", "dogok", "gangnam-yangjae", "gwanggyo"].flatMap((route) => [
        [`commute-${route}`, "up", { strategy: "car" }],
        [`commute-${route}`, "down", { strategy: "car" }],
      ]),
    ]);
    expect(LANE_HOURS).toEqual({ from: "07:00", to: "21:00" });
  });
});

describe("assertLaneStrategies", () => {
  const thrown = (run: () => void): string => {
    try {
      run();
      return "";
    } catch (err) {
      return (err as Error).message;
    }
  };

  it("passes today's strategies and lane hours against the sequences the app estimates", () => {
    // Act & Assert
    expect(() => assertLaneStrategies(LANE_STRATEGIES, estimatedSequences)).not.toThrow();
  });

  it("throws for a strategy on a sequence that is not estimated, naming the sequence at its path", () => {
    // Arrange
    const strategies = { ...LANE_STRATEGIES, "fasttrack-inja": { regular: { strategy: "busLane", direction: "southbound" } as const } };

    // Act
    const message = thrown(() => assertLaneStrategies(strategies, estimatedSequences));

    // Assert
    expect(message).toMatch(/strategies\.fasttrack-inja\.regular: "fasttrack-inja regular" is not an estimated sequence/);
  });

  it("throws for lane hours out of order, naming them", () => {
    // Act
    const message = thrown(() => assertLaneStrategies(LANE_STRATEGIES, estimatedSequences, { from: "21:00", to: "07:00" }));

    // Assert
    expect(message).toMatch(/laneHours: from 21:00 must be before to 07:00/);
  });

  it("accepts lane hours one minute long and refuses them empty", () => {
    // Act
    const oneMinute = thrown(() => assertLaneStrategies(LANE_STRATEGIES, estimatedSequences, { from: "07:00", to: "07:01" }));
    const empty = thrown(() => assertLaneStrategies(LANE_STRATEGIES, estimatedSequences, { from: "07:00", to: "07:00" }));

    // Assert
    expect(oneMinute).toBe("");
    expect(empty).toMatch(/laneHours: from 07:00 must be before to 07:00/);
  });

  it("throws for a lane hour that is not HH:mm, naming its path", () => {
    // Act
    const message = thrown(() => assertLaneStrategies(LANE_STRATEGIES, estimatedSequences, { from: "7:00", to: "21:00" }));

    // Assert
    expect(message).toMatch(/laneHours\.from: must be HH:mm/);
  });

  it("names every issue at once: a sequence that is not estimated and lane hours out of order", () => {
    // Arrange
    const strategies = { ...LANE_STRATEGIES, "campus-inja": { ...LANE_STRATEGIES["campus-inja"], night: { strategy: "car" } as const } };

    // Act
    const message = thrown(() => assertLaneStrategies(strategies, estimatedSequences, { from: "21:00", to: "07:00" }));

    // Assert
    expect(message).toContain("strategies.campus-inja.night: ");
    expect(message).toContain("laneHours: ");
  });
});

describe("strategyIssues", () => {
  const estimated = [
    { serviceId: "campus-inja", routeType: "regular" },
    { serviceId: "campus-inja", routeType: "hakbu" },
    { serviceId: "campus-jain", routeType: "regular" },
    { serviceId: "campus-jain", routeType: "hakbu" },
  ];

  it("passes when every configured sequence is estimated", () => {
    // Act & Assert
    expect(strategyIssues(STRATEGIES, estimated)).toEqual([]);
  });

  it("names every configured sequence the app does not estimate", () => {
    // Arrange
    const strategies: LaneConfig["strategies"] = {
      ...STRATEGIES,
      "campus-inja": { ...STRATEGIES["campus-inja"], night: { strategy: "car" } },
      "commute-jamsil": { down: { strategy: "busLane", direction: "southbound" } },
    };

    // Act
    const issues = strategyIssues(strategies, estimated);

    // Assert
    expect(issues).toEqual([
      { path: ["strategies", "campus-inja", "night"], message: expect.stringContaining("campus-inja night") },
      { path: ["strategies", "commute-jamsil", "down"], message: expect.stringContaining("commute-jamsil down") },
    ]);
  });
});

describe("corridorIssues", () => {
  it("passes a consistent config", () => {
    // Act & Assert
    expect(corridorIssues(config())).toEqual([]);
  });

  it.each([
    ["2 m short of", END_M - 2, false],
    ["1 m short of", END_M - 1, true],
    ["at", END_M, true],
    ["1 m past", END_M + 1, true],
    ["2 m past", END_M + 2, false],
  ])("checks that the last boundary sits at the centerline's end, rounded to the meter: %s it", (_case, alongM, passes) => {
    // Arrange
    const shifted = withBoundaries([
      { name: "north", alongM: 0 },
      { name: "south", alongM },
    ]);

    // Act
    const issues = corridorIssues(shifted);

    // Assert
    expect(issues).toEqual(passes ? [] : [{ path: ["corridor", "boundaries", 1, "alongM"], message: expect.stringContaining('"south"') }]);
  });

  it("lists every cross-check issue at once", () => {
    // Arrange
    const broken = config({
      corridor: {
        ...config().corridor,
        boundaries: [
          { name: "north", alongM: 12 },
          { name: "middle", alongM: 1500 },
          { name: "middle-2", alongM: 1500 },
          { name: "south", alongM: 9000 },
        ],
      },
      probeRoutes: [
        { routeId: "200000205", name: "8800", sectOrds: { southbound: { from: 56, to: 45 }, northbound: { from: 15, to: 27 } } },
        { routeId: "200000205", name: "8800 again", sectOrds: { southbound: { from: 20, to: 30 }, northbound: { from: 15, to: 27 } } },
      ],
    });

    // Act
    const issues = corridorIssues(broken);

    // Assert
    expect(issues.map((issue) => issue.path)).toEqual([
      ["corridor", "boundaries", 0, "alongM"],
      ["corridor", "boundaries", 2, "alongM"],
      ["corridor", "boundaries", 3, "alongM"],
      ["probeRoutes", 0, "sectOrds", "southbound"],
      ["probeRoutes", 1, "routeId"],
      ["probeRoutes", 1, "sectOrds"],
    ]);
  });

  it("refuses ranges whose directions share a section, since the range decides the direction", () => {
    // Arrange
    const overlapping = config({
      probeRoutes: [{ routeId: "200000205", name: "8800", sectOrds: { southbound: { from: 20, to: 30 }, northbound: { from: 30, to: 40 } } }],
    });

    // Act
    const issues = corridorIssues(overlapping);

    // Assert
    expect(issues).toEqual([{ path: ["probeRoutes", 0, "sectOrds"], message: expect.stringContaining("8800") }]);
  });

  it("passes revision 1 of the bus-lane-corridor dataset", () => {
    // Act & Assert
    expect(corridorIssues(corridorFixture())).toEqual([]);
  });

  it("Boundary past the end: refuses a last boundary 500 m past the centerline's end, naming that boundary's path", () => {
    // Arrange
    const data = corridorFixture();
    const last = data.corridor.boundaries.length - 1;
    data.corridor.boundaries[last]!.alongM += 500;

    // Act
    const issues = corridorIssues(data);

    // Assert
    expect(issues).toEqual([{ path: ["corridor", "boundaries", last, "alongM"], message: expect.stringContaining('"신갈JC"') }]);
  });

  it.each(["southbound", "northbound"] as const)("refuses %s entry and exit swapped, naming the direction's path", (direction) => {
    // Arrange
    const data = corridorFixture();
    const { entry, exit } = data.entryExit[direction];
    data.entryExit[direction] = { entry: exit, exit: entry };

    // Act
    const issues = corridorIssues(data);

    // Assert
    expect(issues).toEqual([{ path: ["entryExit", direction], message: expect.stringContaining(direction) }]);
  });

  it("refuses an entry 3 km off the centerline, naming its path", () => {
    // Arrange
    const data = corridorFixture();
    const { entry } = data.entryExit.southbound;
    data.entryExit.southbound.entry = { lat: entry.lat, lng: entry.lng + 3000 / LNG_DEGREE_M };

    // Act
    const issues = corridorIssues(data);

    // Assert
    expect(issues).toEqual([{ path: ["entryExit", "southbound", "entry"], message: expect.stringContaining("off the centerline") }]);
  });

  it.each([
    ["499 m", 499, true],
    ["501 m", 501, false],
  ])("checks that an exit lies at most 500 m off the centerline: %s off", (_case, offsetM, passes) => {
    // Arrange
    const base = config();
    // The southbound exit is the centerline's last vertex, so moving it east moves it straight off the line.
    const exit = { lat: 37.48, lng: 127.02 + offsetM / LNG_DEGREE_M };
    const shifted = config({ entryExit: { ...base.entryExit, southbound: { ...base.entryExit.southbound, exit } } });

    // Act
    const issues = corridorIssues(shifted);

    // Assert
    expect(issues).toEqual(passes ? [] : [{ path: ["entryExit", "southbound", "exit"], message: expect.stringContaining("501 m off the centerline") }]);
  });

  it("Probe route listed twice: refuses 200000205 listed again, naming the second entry's routeId", () => {
    // Arrange
    const data = corridorFixture();
    data.probeRoutes.push(structuredClone(data.probeRoutes[0]!));

    // Act
    const issues = corridorIssues(data);

    // Assert
    expect(issues).toEqual([{ path: ["probeRoutes", 3, "routeId"], message: expect.stringContaining("200000205") }]);
  });
});

describe("strategyOfRun", () => {
  it.each([
    ["06:59", { strategy: "car" }],
    ["07:00", { strategy: "busLane", direction: "southbound" }],
    ["20:59", { strategy: "busLane", direction: "southbound" }],
    ["21:00", { strategy: "car" }],
    ["21:30", { strategy: "car" }],
  ])("gives a bus-lane sequence's run departing at %s the strategy %j: lane hours end exclusive", (time, expected) => {
    // Act
    const strategy = strategyOfRun(config(), { serviceId: "campus-inja", routeType: "regular", time });

    // Assert
    expect(strategy).toEqual(expected);
  });

  it("keeps a car sequence's run in lane hours on car", () => {
    // Act
    const strategy = strategyOfRun(config(), { serviceId: "campus-jain", routeType: "hakbu", time: "12:00" });

    // Assert
    expect(strategy).toEqual({ strategy: "car" });
  });
});

describe("toLegBounds", () => {
  it("projects the entry and the exit onto the centerline, in the direction's order", () => {
    // Arrange
    const corridor = config().corridor;

    // Act
    const southbound = toLegBounds(corridor, { entry: { lat: 37.495, lng: 127.02 }, exit: { lat: 37.485, lng: 127.02 } });
    const northbound = toLegBounds(corridor, { entry: { lat: 37.485, lng: 127.02 }, exit: { lat: 37.495, lng: 127.02 } });

    // Assert
    expect(southbound.fromAlongM).toBeCloseTo(STEP_M / 2, 0);
    expect(southbound.toAlongM).toBeCloseTo(1.5 * STEP_M, 0);
    expect(northbound).toEqual({ fromAlongM: southbound.toAlongM, toAlongM: southbound.fromAlongM });
  });
});
