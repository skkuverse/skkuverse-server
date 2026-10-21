/**
 * BusEtaLaneService, the lane's door: the strategies and lane hours are code, checked against each bus-stops
 * revision's estimated sequences (unify-bus-stops design D16), so a revision they do not fit rejects every tick and is
 * logged once (it replaces the check at construction, whose case "fails construction when the lane strategies name a
 * sequence the app does not estimate" is now "Strategy for an unknown sequence"); a run's strategy follows the lane hours. The corridor is the stored
 * `bus-lane-corridor` dataset (move-reference-datasets D9; ADR 0013, D6), read over an in-memory store and a fixed
 * clock: `corridor()` answers one revision's snapshot (its centerline, probe routes, each direction's ends and leg
 * bounds), cached for DATASET_CACHE_TTL_MS so a push is seen within a minute, kept through a failed reload for
 * DATASET_STALE_WINDOW_MS, and `null` when no good corridor was read, which the live tick answers with the car model.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { corridorFixture } from "../../../../__tests__/helpers/bus/bus-lane-corridor";
import { FakeBusEtaLaneRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta-lane.repository.fake";
import { FakeBusEtaRepository } from "../../../../__tests__/helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusStopsRepository } from "../../../../__tests__/helpers/fakes/bus/bus-stops.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../../infra/clock";
import logger from "../../../infra/logger";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../../shared/dataset.constants";
import type { BusScheduleService } from "../../schedule/bus-schedule.service";
import { storedBusStopsService } from "../../../../__tests__/helpers/bus/bus-stops";
import type { BusEtaRepository } from "../bus-eta.repository";
import { BusEtaService } from "../bus-eta.service";
import type { EtaSequence } from "../bus-eta.types";
import type { BusEtaLaneRepository } from "./bus-eta-lane.repository";
import { BusEtaLaneService } from "./bus-eta-lane.service";

const NOW = new Date("2026-10-20T04:00:00.000Z");
const eta = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), {} as BusScheduleService, storedBusStopsService());
const mockedLogger = logger as unknown as Record<"error", jest.Mock>;

function setup(sequencesOf: BusEtaService = eta) {
  let now = NOW;
  const clock: Clock = { now: () => now };
  const repository = new FakeBusEtaLaneRepository();
  const lane = new BusEtaLaneService(sequencesOf, asReal<BusEtaLaneRepository>(repository), clock);
  // The clock and Date.now() move together: the dataset loader reads the one, the cached loader the other.
  const advanceTo = (msAfterNow: number): void => {
    now = new Date(NOW.getTime() + msAfterNow);
    jest.setSystemTime(now);
  };
  return { repository, lane, advanceTo };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("BusEtaLaneService.sequences", () => {
  it("answers the estimated sequences of the current bus-stops revision, which the lane strategies fit", async () => {
    // Arrange
    const { lane } = setup();

    // Act
    const sequences = await lane.sequences();

    // Assert
    expect(sequences).toEqual(await eta.sequences());
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  it("Strategy for an unknown sequence: rejects every tick of a revision that leaves a strategy's sequence unestimated, logged once", async () => {
    // Arrange
    const unestimated: readonly EtaSequence[] = [];
    const { lane } = setup({ sequences: async () => unestimated } as unknown as BusEtaService);

    // Act
    const first = lane.sequences();
    await first.catch(() => undefined);
    const second = lane.sequences();

    // Assert
    await expect(first).rejects.toThrow(/campus-inja regular/);
    await expect(second).rejects.toThrow(/campus-inja regular/);
    expect(mockedLogger.error.mock.calls.map(([fields]) => fields.event)).toEqual(["bus.eta.lane_strategy_unmatched"]);
  });

  it("rejects while the stops were never read, as the estimated sequences do", async () => {
    // Arrange
    const never = new BusEtaService(asReal<BusEtaRepository>(new FakeBusEtaRepository()), {} as BusScheduleService, storedBusStopsService(new FakeBusStopsRepository()));
    const { lane } = setup(never);

    // Act & Assert
    await expect(lane.sequences()).rejects.toMatchObject({ code: "BUS_STOPS_UNAVAILABLE", httpStatus: 503 });
  });
});

describe("BusEtaLaneService.strategyOfRun", () => {
  it.each([
    ["06:59", { strategy: "car" }],
    ["07:00", { strategy: "busLane", direction: "southbound" }],
    ["21:00", { strategy: "car" }],
  ])("gives a campus-inja regular run departing at %s the strategy %j", (time, expected) => {
    // Arrange
    const { lane } = setup();

    // Act
    const strategy = lane.strategyOfRun({ serviceId: "campus-inja", routeType: "regular", time });

    // Assert
    expect(strategy).toEqual(expected);
  });

  it("Which runs are bus-lane runs: a 14:00 hakbu run of campus-inja is one with no corridor stored", () => {
    // Arrange
    const { repository, lane } = setup();

    // Act
    const strategy = lane.strategyOfRun({ serviceId: "campus-inja", routeType: "hakbu", time: "14:00" });

    // Assert
    expect(strategy).toEqual({ strategy: "busLane", direction: "southbound" });
    expect(repository.readCount).toBe(0);
  });
});

describe("BusEtaLaneService.corridor", () => {
  it("answers the stored revision's centerline and its probe routes, 8800, 5000 and 5005 by their TOPIS route ids", async () => {
    // Arrange
    const { repository, lane } = setup();
    repository.storeCorridor(corridorFixture());

    // Act
    const corridor = await lane.corridor();

    // Assert
    expect(corridor?.revision).toBe(1);
    expect(corridor?.corridor).toEqual(corridorFixture().corridor);
    expect(corridor?.probeRoutes.map((route) => [route.routeId, route.name])).toEqual([
      ["200000205", "8800"],
      ["228000174", "5000"],
      ["228000175", "5005"],
    ]);
  });

  it.each(["southbound", "northbound"] as const)("gives the stored %s entry and exit", async (direction) => {
    // Arrange
    const { repository, lane } = setup();
    repository.storeCorridor(corridorFixture());

    // Act
    const corridor = await lane.corridor();

    // Assert
    expect(corridor?.corridorEndsOf(direction)).toEqual(corridorFixture().entryExit[direction]);
  });

  it("runs the southbound leg toward larger along-distances and the northbound back, over most of the 27.4 km corridor", async () => {
    // Arrange
    const { repository, lane } = setup();
    repository.storeCorridor(corridorFixture());

    // Act
    const corridor = await lane.corridor();
    const southbound = corridor!.legBoundsOf("southbound");
    const northbound = corridor!.legBoundsOf("northbound");

    // Assert
    expect(southbound.toAlongM - southbound.fromAlongM).toBeGreaterThan(26_000);
    expect(northbound.fromAlongM - northbound.toAlongM).toBeGreaterThan(26_000);
    expect(Math.max(southbound.toAlongM, northbound.fromAlongM)).toBeLessThanOrEqual(27_383);
  });

  it("Corridor never read: answers null with no corridor stored, and with only an invalid one", async () => {
    // Arrange
    const { repository, lane, advanceTo } = setup();

    // Act
    const missing = await lane.corridor();
    repository.storeCorridor({ ...corridorFixture(), probeRoutes: [] });
    advanceTo(DATASET_CACHE_TTL_MS);
    const invalid = await lane.corridor();

    // Assert
    expect(missing).toBeNull();
    expect(invalid).toBeNull();
    expect(repository.readCount).toBe(2);
  });

  it("Fresh poller, database down: answers null on a first read that fails, logging bus.lane_corridor.read_failed", async () => {
    // Arrange
    const { repository, lane } = setup();
    const failure = new Error("server selection timed out");
    repository.failWith = failure;

    // Act
    const corridor = await lane.corridor();

    // Assert
    expect(corridor).toBeNull();
    expect(mockedLogger.error.mock.calls.map(([fields]) => fields)).toEqual([expect.objectContaining({ event: "bus.lane_corridor.read_failed", err: failure })]);
  });

  it("Probe routes edited: serves a push that drops 8800 once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, lane, advanceTo } = setup();
    repository.storeCorridor(corridorFixture());
    await lane.corridor();
    const edited = corridorFixture();
    edited.probeRoutes = edited.probeRoutes.filter((route) => route.name !== "8800");
    repository.storeCorridor(edited);

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const beforeTtl = await lane.corridor();
    advanceTo(DATASET_CACHE_TTL_MS);
    const atTtl = await lane.corridor();

    // Assert
    expect(beforeTtl?.probeRoutes.map((route) => route.name)).toEqual(["8800", "5000", "5005"]);
    expect(atTtl?.revision).toBe(2);
    expect(atTtl?.probeRoutes.map((route) => route.name)).toEqual(["5000", "5005"]);
  });

  it("Corridor read before a DB blip: keeps the last good corridor through failed reloads for 24 hours, then answers null", async () => {
    // Arrange
    const { repository, lane, advanceTo } = setup();
    repository.storeCorridor(corridorFixture());
    const good = await lane.corridor();
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_CACHE_TTL_MS);
    const afterBlip = await lane.corridor();
    advanceTo(DATASET_STALE_WINDOW_MS - 1);
    const lastStaleMoment = await lane.corridor();
    advanceTo(DATASET_STALE_WINDOW_MS + DATASET_CACHE_TTL_MS);
    const pastWindow = await lane.corridor();

    // Assert
    expect(afterBlip).toBe(good);
    expect(lastStaleMoment).toBe(good);
    expect(pastWindow).toBeNull();
  });
});
