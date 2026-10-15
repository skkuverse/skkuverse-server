/**
 * BuildingSyncPoller registers BuildingSyncService.run() with the poller
 * registry under name "building-sync" at the configured interval, and a
 * rejected run reaches the registry unchanged, so a failed sync is declared
 * failing like any other poller. The registry is a `registerPoller` spy (ADR
 * 0011 D2) and the sync service a stub, so neither the DB nor the SKKU API is
 * touched; the logger is mocked for the BUILDING_SYNC=off line.
 */
jest.mock("../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import config from "../../infra/config";
import type { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BuildingSyncPoller } from "./building-sync.poller";
import type { BuildingSyncService } from "./building-sync.service";

const mockedSync = jest.fn<Promise<void>, []>();
const sync = { run: mockedSync } as unknown as BuildingSyncService;
const registerPoller = jest.fn<void, Parameters<PollerRegistryService["registerPoller"]>>();
const registry = { registerPoller } as unknown as PollerRegistryService;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BuildingSyncPoller.onModuleInit", () => {
  it("registers a 'building-sync' poller at config.building.syncIntervalMs", () => {
    // Act
    new BuildingSyncPoller(registry, sync).onModuleInit();

    // Assert
    expect(registerPoller).toHaveBeenCalledTimes(1);
    const [fn, intervalMs, name] = registerPoller.mock.calls[0]!;
    expect(intervalMs).toBe(config.building.syncIntervalMs);
    expect(name).toBe("building-sync");
    expect(typeof fn).toBe("function");
  });

  it("registered fn passes a sync rejection to the registry unchanged", async () => {
    // Arrange
    new BuildingSyncPoller(registry, sync).onModuleInit();
    const fn = registerPoller.mock.calls[0]![0];
    const syncError = new AggregateError([new Error("crawl failed")], "phase 1 failed");
    mockedSync.mockRejectedValueOnce(syncError);

    // Act
    const outcome = Promise.resolve(fn());

    // Assert
    await expect(outcome).rejects.toBe(syncError);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it("registers nothing when BUILDING_SYNC resolved to off (the development default)", () => {
    // Arrange
    const saved = config.building.syncEnabled;
    config.building.syncEnabled = false;
    try {
      // Act
      new BuildingSyncPoller(registry, sync).onModuleInit();

      // Assert
      expect(registerPoller).not.toHaveBeenCalled();
      expect(mockedSync).not.toHaveBeenCalled();
    } finally {
      config.building.syncEnabled = saved;
    }
  });

  it("registered fn resolves on sync success", async () => {
    // Arrange
    new BuildingSyncPoller(registry, sync).onModuleInit();
    const fn = registerPoller.mock.calls[0]![0];
    mockedSync.mockResolvedValueOnce(undefined);

    // Act
    const outcome = Promise.resolve(fn());

    // Assert
    await expect(outcome).resolves.toBeUndefined();
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });
});
