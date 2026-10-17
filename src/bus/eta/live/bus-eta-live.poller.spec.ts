/**
 * BusEtaLivePoller registers `shuttle-eta-live` every 60 s with SHUTTLE_ETA on, and
 * nothing with it off, so no directions call and no bus position request is
 * made; its tick is the engine's, at the clock's time, and rejects with it.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import type { Clock } from "../../../infra/clock";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import type { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import type { BusEtaService } from "../bus-eta.service";
import type { BusEtaTravelService } from "../travel/bus-eta-travel.service";
import { BusEtaLivePoller } from "./bus-eta-live.poller";

const shuttleEta = config.shuttleEta as { enabled: boolean };
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const NOW = new Date("2026-10-12T00:30:00.000Z");
const clock: Clock = { now: () => NOW };
const eta = {
  sequences: () => [],
  runsOn: jest.fn(),
  upcomingRuns: jest.fn(),
  listFitting: jest.fn(async () => []),
  upsertFitting: jest.fn(),
} as unknown as BusEtaService;
const travel = { strategyOfRun: jest.fn(), fetchOffsets: jest.fn(), fetchCorridorRoute: jest.fn(), legTime: jest.fn(), prime: jest.fn() };
const client = travel as unknown as BusEtaTravelService;

describe("BusEtaLivePoller.onModuleInit", () => {
  const enabled = shuttleEta.enabled;
  afterEach(() => {
    shuttleEta.enabled = enabled;
    jest.clearAllMocks();
  });

  it("SHUTTLE_ETA=off says so once, naming the poller it leaves out", () => {
    // Arrange
    shuttleEta.enabled = false;

    // Act
    new BusEtaLivePoller(registry, eta, client, clock).onModuleInit();

    // Assert
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ event: "bus.eta.disabled", poller: "shuttle-eta-live" }, expect.any(String));
  });

  it("SHUTTLE_ETA=off registers nothing", () => {
    // Arrange
    shuttleEta.enabled = false;

    // Act
    new BusEtaLivePoller(registry, eta, client, clock).onModuleInit();

    // Assert
    expect(registerPoller).not.toHaveBeenCalled();
  });

  it("The estimate switch covers bus positions: SHUTTLE_ETA=off makes no probe request", async () => {
    // Arrange
    shuttleEta.enabled = false;

    // Act
    new BusEtaLivePoller(registry, eta, client, clock).onModuleInit();

    // Assert
    expect(travel.prime).not.toHaveBeenCalled();
    expect(travel.legTime).not.toHaveBeenCalled();
    expect(travel.fetchCorridorRoute).not.toHaveBeenCalled();
  });

  it("registers shuttle-eta-live every 60 s, a tick with no sequence making no call", async () => {
    // Arrange
    shuttleEta.enabled = true;

    // Act
    new BusEtaLivePoller(registry, eta, client, clock).onModuleInit();

    // Assert
    expect(registerPoller.mock.calls.map((c) => [c[2], c[1]])).toEqual([["shuttle-eta-live", 60_000]]);
    await expect((registerPoller.mock.calls[0]![0] as () => Promise<unknown>)()).resolves.toEqual({ calls: 0, written: 0 });
  });
});
