/**
 * BusEtaLaneService, the lane config's door, on the committed bus-lane.json: a bad config against the estimated
 * sequences fails construction; a run's strategy follows the lane hours; and each direction's corridor ends and leg
 * bounds, the corridor and the probe routes are the config's own.
 */
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { BusScheduleService } from "../../schedule/bus-schedule.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import { SubwayStationsService } from "../../../subway/stations/subway-stations.service";
import type { BusEtaRepository } from "../bus-eta.repository";
import { BusEtaService } from "../bus-eta.service";
import { BusEtaLaneService } from "./bus-eta-lane.service";

const committed: { entryExit: Record<string, unknown>; corridor: { centerline: unknown[] } } = require("./bus-lane.json");

const eta = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), {} as BusScheduleService, new BusStopsService(new SubwayStationsService()));
const lane = new BusEtaLaneService(eta);

describe("BusEtaLaneService", () => {
  it("fails construction when the lane config names a sequence the app does not estimate", () => {
    // Arrange
    const noSequences = { sequences: () => [] } as unknown as BusEtaService;

    // Act & Assert
    expect(() => new BusEtaLaneService(noSequences)).toThrow(/campus-inja regular/);
  });
});

describe("BusEtaLaneService.strategyOfRun", () => {
  it.each([
    ["06:59", { strategy: "car" }],
    ["07:00", { strategy: "busLane", direction: "southbound" }],
    ["21:00", { strategy: "car" }],
  ])("gives a campus-inja regular run departing at %s the strategy %j", (time, expected) => {
    // Act
    const strategy = lane.strategyOfRun({ serviceId: "campus-inja", routeType: "regular", time });

    // Assert
    expect(strategy).toEqual(expected);
  });
});

describe("BusEtaLaneService.corridorEndsOf", () => {
  it.each(["southbound", "northbound"] as const)("returns the configured %s entry and exit", (direction) => {
    // Act
    const ends = lane.corridorEndsOf(direction);

    // Assert
    expect(ends).toEqual(committed.entryExit[direction]);
  });
});

describe("BusEtaLaneService.legBoundsOf", () => {
  it("runs southbound toward larger along-distances and northbound back, over most of the 27.4 km corridor", () => {
    // Act
    const southbound = lane.legBoundsOf("southbound");
    const northbound = lane.legBoundsOf("northbound");

    // Assert
    expect(southbound.toAlongM - southbound.fromAlongM).toBeGreaterThan(26_000);
    expect(northbound.fromAlongM - northbound.toAlongM).toBeGreaterThan(26_000);
    expect(Math.max(southbound.toAlongM, northbound.fromAlongM)).toBeLessThanOrEqual(27_383);
  });
});

describe("BusEtaLaneService.corridor", () => {
  it("returns the configured centerline", () => {
    // Act
    const corridor = lane.corridor();

    // Assert
    expect(corridor.centerline).toEqual(committed.corridor.centerline);
  });
});

describe("BusEtaLaneService.probeRoutes", () => {
  it("returns 8800, 5000 and 5005 by their TOPIS route ids", () => {
    // Act
    const routes = lane.probeRoutes();

    // Assert
    expect(routes.map((route) => [route.routeId, route.name])).toEqual([
      ["200000205", "8800"],
      ["228000174", "5000"],
      ["228000175", "5005"],
    ]);
  });
});
