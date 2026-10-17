/**
 * BuildingCafeteriaPoller registers BuildingCafeteriaService.run() with the
 * poller registry under name "building-cafeteria-sync" at the building sync's
 * interval, and a rejected run reaches the registry unchanged, so a failed
 * cafeteria sync is declared failing like any other poller. BUILDING_SYNC=off
 * registers nothing, as for the building sync. The registry is a
 * `registerPoller` spy (ADR 0011 D2) and the service a stub.
 */
jest.mock("../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import config from "../../infra/config";
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BuildingCafeteriaPoller } from "./building-cafeteria.poller";
import type { BuildingCafeteriaService } from "./building-cafeteria.service";

const mockedRun = jest.fn<Promise<void>, []>();
const sync = { run: mockedRun } as unknown as BuildingCafeteriaService;
const registerPoller = jest.fn<void, Parameters<PollerRegistryService["registerPoller"]>>();
const registry = { registerPoller } as unknown as PollerRegistryService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BuildingCafeteriaPoller.onModuleInit", () => {
  it("registers a 'building-cafeteria-sync' poller at config.building.syncIntervalMs", () => {
    // Act
    new BuildingCafeteriaPoller(registry, sync).onModuleInit();

    // Assert
    expect(registerPoller).toHaveBeenCalledTimes(1);
    const [fn, intervalMs, name] = registerPoller.mock.calls[0]!;
    expect(intervalMs).toBe(config.building.syncIntervalMs);
    expect(name).toBe("building-cafeteria-sync");
    expect(typeof fn).toBe("function");
  });

  it("registered fn passes a run's rejection to the registry unchanged", async () => {
    // Arrange
    new BuildingCafeteriaPoller(registry, sync).onModuleInit();
    const fn = registerPoller.mock.calls[0]![0];
    const runError = new Error("sisulList listed no cafeteria; nothing written");
    mockedRun.mockRejectedValueOnce(runError);

    // Act
    const outcome = Promise.resolve(fn());

    // Assert
    await expect(outcome).rejects.toBe(runError);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("registers nothing when BUILDING_SYNC resolved to off (the development default)", () => {
    // Arrange
    const saved = config.building.syncEnabled;
    config.building.syncEnabled = false;
    try {
      // Act
      new BuildingCafeteriaPoller(registry, sync).onModuleInit();

      // Assert
      expect(registerPoller).not.toHaveBeenCalled();
      expect(mockedRun).not.toHaveBeenCalled();
    } finally {
      config.building.syncEnabled = saved;
    }
  });
});
