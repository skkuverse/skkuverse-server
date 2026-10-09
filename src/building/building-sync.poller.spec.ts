/**
 * Unit test for BuildingSyncService — verifies it registers syncBuildings()
 * with the Nest PollerRegistry under name "building-sync" at the configured
 * interval, and that a syncBuildings rejection reaches the registry unchanged,
 * so a failed sync is declared failing like any other poller. syncBuildings is
 * mocked so neither the DB nor the SKKU API is touched; the logger and Sentry
 * are mocked for the registry.
 */

jest.mock("./building.sync", () => ({
  syncBuildings: jest.fn(),
}));
jest.mock("../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("@sentry/nestjs", () => ({
  captureException: jest.fn(),
  captureCheckIn: jest.fn(),
}));

import config from "../infra/config";
import { syncBuildings } from "./building.sync";
import { BuildingSyncService } from "./building-sync.service";
import { PollerRegistryService } from "../scheduling/poller-registry.service";

const mockedSync = syncBuildings as jest.MockedFunction<typeof syncBuildings>;

/** Lets the registry's outcome handlers for the warm-up run settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

let registry: PollerRegistryService;

beforeEach(() => {
  jest.clearAllMocks();
  registry = new PollerRegistryService();
});

afterEach(() => {
  registry.stopAll();
});

describe("BuildingSyncService.onModuleInit", () => {
  it("registers a 'building-sync' poller at config.building.syncIntervalMs", () => {
    const spy = jest.spyOn(registry, "registerPoller");

    new BuildingSyncService(registry).onModuleInit();

    expect(spy).toHaveBeenCalledTimes(1);
    const [fn, intervalMs, name] = spy.mock.calls[0]!;
    expect(intervalMs).toBe(config.building.syncIntervalMs);
    expect(name).toBe("building-sync");
    expect(typeof fn).toBe("function");
  });

  it("registered fn passes a syncBuildings rejection to the registry unchanged", async () => {
    const spy = jest.spyOn(registry, "registerPoller");
    new BuildingSyncService(registry).onModuleInit();
    const fn = spy.mock.calls[0]![0];
    const syncError = new AggregateError([new Error("crawl failed")], "phase 1 failed");
    mockedSync.mockRejectedValueOnce(syncError);

    const outcome = Promise.resolve(fn());

    await expect(outcome).rejects.toBe(syncError);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it("registers nothing when BUILDING_SYNC resolved to off (the development default)", () => {
    const saved = config.building.syncEnabled;
    config.building.syncEnabled = false;
    try {
      const spy = jest.spyOn(registry, "registerPoller");
      new BuildingSyncService(registry).onModuleInit();
      expect(spy).not.toHaveBeenCalled();
      expect(mockedSync).not.toHaveBeenCalled();
    } finally {
      config.building.syncEnabled = saved;
    }
  });

  it("registered fn resolves on syncBuildings success", async () => {
    const spy = jest.spyOn(registry, "registerPoller");
    new BuildingSyncService(registry).onModuleInit();
    const fn = spy.mock.calls[0]![0];
    mockedSync.mockResolvedValueOnce(undefined);

    const outcome = Promise.resolve(fn());

    await expect(outcome).resolves.toBeUndefined();
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it("a failed sync makes the registry declare 'building-sync' failing", async () => {
    new BuildingSyncService(registry).onModuleInit();
    mockedSync.mockRejectedValueOnce(new Error("crawl failed"));

    registry.startAll();
    await settle();

    expect(registry.failingPollers()).toEqual(["building-sync"]);
  });
});
