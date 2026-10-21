/**
 * BusEtaBaselinePoller registers `shuttle-eta-baseline` every 5 min with SHUTTLE_ETA on, and
 * nothing with it off, so no directions call is made; its tick is the engine's,
 * at the clock's time, and rejects with it.
 */
jest.mock("../../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import type { Clock } from "../../../infra/clock";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import type { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import type { BusEtaService } from "../bus-eta.service";
import type { BusEtaForecastService } from "../forecast/bus-eta-forecast.service";
import { BusEtaBaselinePoller } from "./bus-eta-baseline.poller";

const shuttleEta = config.shuttleEta as { enabled: boolean };
const registerPoller = jest.fn();
const registry = { registerPoller } as unknown as PollerRegistryService;
const NOW = new Date("2026-10-12T00:30:00.000Z");
// WHY: what the estimated sequences reject with while the stops were never read (BusStopsUnavailableError).
const NEVER_READ = Object.assign(new Error("The bus stops are unavailable"), { code: "BUS_STOPS_UNAVAILABLE" });
const clock: Clock = { now: () => NOW };
const eta = {
  sequences: () => [],
  runsOn: jest.fn(),
  upcomingRuns: jest.fn(),
  listFitting: jest.fn(async () => []),
  upsertFitting: jest.fn(),
} as unknown as BusEtaService;
const forecastSequences = jest.fn(async (): Promise<unknown[]> => []);
const fetchOffsets = jest.fn();
const forecast = { sequences: forecastSequences, fetchOffsets } as unknown as BusEtaForecastService;

describe("BusEtaBaselinePoller.onModuleInit", () => {
  const enabled = shuttleEta.enabled;
  afterEach(() => {
    shuttleEta.enabled = enabled;
    jest.clearAllMocks();
  });

  it("SHUTTLE_ETA=off says so once, naming the poller it leaves out", () => {
    // Arrange
    shuttleEta.enabled = false;

    // Act
    new BusEtaBaselinePoller(registry, eta, forecast, clock).onModuleInit();

    // Assert
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ event: "bus.eta.disabled", poller: "shuttle-eta-baseline" }, expect.any(String));
  });

  it("SHUTTLE_ETA=off registers nothing", () => {
    // Arrange
    shuttleEta.enabled = false;

    // Act
    new BusEtaBaselinePoller(registry, eta, forecast, clock).onModuleInit();

    // Assert
    expect(registerPoller).not.toHaveBeenCalled();
  });

  it("registers shuttle-eta-baseline every 5 min, a tick with no sequence making no call", async () => {
    // Arrange
    shuttleEta.enabled = true;

    // Act
    new BusEtaBaselinePoller(registry, eta, forecast, clock).onModuleInit();

    // Assert
    expect(registerPoller.mock.calls.map((c) => [c[2], c[1]])).toEqual([["shuttle-eta-baseline", 300_000]]);
    await expect((registerPoller.mock.calls[0]![0] as () => Promise<unknown>)()).resolves.toEqual({ calls: 0, written: 0 });
  });

  it("Never read: a tick while the stops were never read rejects, asking TMAP nothing", async () => {
    // Arrange
    shuttleEta.enabled = true;
    forecastSequences.mockRejectedValueOnce(NEVER_READ);
    new BusEtaBaselinePoller(registry, eta, forecast, clock).onModuleInit();

    // Act
    const tick = (registerPoller.mock.calls[0]![0] as () => Promise<unknown>)();

    // Assert
    await expect(tick).rejects.toBe(NEVER_READ);
    expect(fetchOffsets).not.toHaveBeenCalled();
  });
});
