/**
 * BusEtaTravelService, the live flow's door to the travel model, over a
 * scripted NAVER client, the lane strategies, the stored corridor
 * (move-reference-datasets D9) and the probe on a scripted TOPIS client: a
 * run's strategy from the lane strategies, the stored corridor's snapshot, the
 * car route through the stops only, the bus-lane route forced through the
 * snapshot's corridor ends with the corridor's own car time, and the probe's
 * leg time and priming over the snapshot.
 */
import { corridorFixture, corridorSnapshot } from "../../../../__tests__/helpers/bus/bus-lane-corridor";
import { FakeBusEtaLaneRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta-lane.repository.fake";
import { FakeBusEtaProbeClient } from "../../../../__tests__/helpers/fakes/bus/bus-eta-probe.client.fake";
import { FakeBusEtaProbeRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta-probe.repository.fake";
import { FakeBusEtaTravelClient } from "../../../../__tests__/helpers/fakes/bus/bus-eta-travel.client.fake";
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import config from "../../../infra/config";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { BusScheduleService } from "../../schedule/bus-schedule.service";
import { storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import type { BusEtaRepository } from "../bus-eta.repository";
import { BusEtaService } from "../bus-eta.service";
import type { BusEtaLaneRepository } from "../lane/bus-eta-lane.repository";
import { BusEtaLaneService } from "../lane/bus-eta-lane.service";
import type { BusEtaProbeClient } from "../probe/bus-eta-probe.client";
import type { BusEtaProbeRepository } from "../probe/bus-eta-probe.repository";
import { BusEtaProbeService } from "../probe/bus-eta-probe.service";
import type { BusEtaTravelClient } from "./bus-eta-travel.client";
import { BusEtaTravelService } from "./bus-eta-travel.service";

// Friday 2026-10-16 13:00 KST.
const NOW = new Date("2026-10-16T04:00:00.000Z");
const STOPS: LatLng[] = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
];
const CREDENTIALS = { keyId: config.shuttleEta.naver.keyId, key: config.shuttleEta.naver.key };

const eta = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), {} as BusScheduleService, storedBusStopsService());
const CORRIDOR = corridorSnapshot();

function setup() {
  const naver = new FakeBusEtaTravelClient();
  const topis = new FakeBusEtaProbeClient();
  const corridors = new FakeBusEtaLaneRepository();
  corridors.storeCorridor(corridorFixture());
  const lane = new BusEtaLaneService(eta, asReal<BusEtaLaneRepository>(corridors), { now: () => NOW });
  const probe = new BusEtaProbeService(asReal<BusEtaProbeClient>(topis), asReal<BusEtaProbeRepository>(new FakeBusEtaProbeRepository()));
  const travel = new BusEtaTravelService(lane, probe, asReal<BusEtaTravelClient>(naver));
  return { naver, topis, corridors, travel };
}

describe("BusEtaTravelService.strategyOfRun", () => {
  it.each([
    ["14:00", { strategy: "busLane", direction: "southbound" }],
    ["21:30", { strategy: "car" }],
  ])("answers the lane config's strategy for a campus-inja run at %s", (time, strategy) => {
    // Arrange
    const { travel } = setup();

    // Act & Assert
    expect(travel.strategyOfRun({ serviceId: "campus-inja", routeType: "regular", time })).toEqual(strategy);
  });
});

describe("BusEtaTravelService.fetchOffsets", () => {
  it("asks NAVER for the route through the stops only, with the configured keys", async () => {
    // Arrange
    const { naver, travel } = setup();

    // Act
    const offsetsSec = await travel.fetchOffsets(STOPS);

    // Assert
    expect(offsetsSec).toEqual([0, 4500]);
    expect(naver.calls).toEqual([{ points: STOPS, credentials: CREDENTIALS }]);
  });
});

describe("BusEtaTravelService.fetchCorridorRoute", () => {
  it("forces the route through the direction's corridor entry and exit, and answers the corridor leg's car time", async () => {
    // Arrange
    const { naver, travel } = setup();
    naver.routeTimes = { stopOffsetsSec: [0, 4620], legsSec: [900, 1920, 1800] };
    const { entry, exit } = corridorFixture().entryExit.southbound;

    // Act
    const route = await travel.fetchCorridorRoute(STOPS, CORRIDOR, "southbound");

    // Assert
    expect(route).toEqual({ stopOffsetsSec: [0, 4620], corridorCarSec: 1920 });
    expect(naver.calls).toEqual([
      {
        points: [
          { at: STOPS[0], kind: "stop" },
          { at: entry, kind: "via" },
          { at: exit, kind: "via" },
          { at: STOPS[1], kind: "stop" },
        ],
        credentials: CREDENTIALS,
      },
    ]);
  });

  it("uses the northbound ends for a northbound route", async () => {
    // Arrange
    const { naver, travel } = setup();
    const { entry, exit } = corridorFixture().entryExit.northbound;

    // Act
    await travel.fetchCorridorRoute(STOPS, CORRIDOR, "northbound");

    // Assert
    expect(naver.calls[0]!.points.slice(1, 3)).toEqual([
      { at: entry, kind: "via" },
      { at: exit, kind: "via" },
    ]);
  });
});

describe("BusEtaTravelService.prime", () => {
  it("takes one snapshot of every probe route", async () => {
    // Arrange
    const { topis, travel } = setup();

    // Act
    await travel.prime(CORRIDOR, NOW);

    // Assert
    expect(topis.calls.map((c) => c.routeId)).toEqual(["200000205", "228000174", "228000175"]);
  });
});

describe("BusEtaTravelService.legTime", () => {
  it("answers the probe's leg time: unavailable with no earlier snapshot", async () => {
    // Arrange
    const { travel } = setup();

    // Act
    const leg = await travel.legTime(CORRIDOR, "southbound", NOW);

    // Assert
    expect(leg).toEqual({ kind: "unavailable", reason: "noSpans", spanCount: 0, coverage: 0 });
  });
});

describe("BusEtaTravelService.corridor", () => {
  it("answers the stored corridor's snapshot", async () => {
    // Arrange
    const { travel } = setup();

    // Act
    const corridor = await travel.corridor();

    // Assert
    expect(corridor?.revision).toBe(1);
    expect(corridor?.corridorEndsOf("southbound")).toEqual(corridorFixture().entryExit.southbound);
  });

  it("answers null when no corridor is stored", async () => {
    // Arrange
    const { corridors, travel } = setup();
    corridors.stored = null;

    // Act
    const corridor = await travel.corridor();

    // Assert
    expect(corridor).toBeNull();
  });
});
